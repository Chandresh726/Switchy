#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>

static NSString *const SwitchyOpenActionIdentifier = @"open";
static NSString *const SwitchyCategoryIdentifier = @"switchy_open";
static NSString *const SwitchyDestinationKey = @"switchy_url";
static NSString *const SwitchyThreadIdentifier = @"switchy-job-matches";

/**
 * Notification destinations are produced by the Switchy server and delivered
 * over this helper's private stdin pipe. This re-check exists only so that a
 * value round-tripped through the notification store can never be handed to
 * NSWorkspace as an arbitrary scheme.
 */
static NSURL *SwitchyLocalURL(id value) {
  if (![value isKindOfClass:[NSString class]]) return nil;
  NSURLComponents *components = [NSURLComponents componentsWithString:value];
  if (!components
      || ![components.scheme isEqualToString:@"http"]
      || ![components.host isEqualToString:@"127.0.0.1"]
      || components.user.length > 0
      || components.password.length > 0) {
    return nil;
  }
  NSInteger port = components.port.integerValue;
  if (port < 1 || port > 65535) return nil;
  return components.URL;
}

@interface SwitchyProtocolOutput : NSObject
@property(nonatomic, strong) NSLock *lock;
- (void)send:(NSDictionary<NSString *, id> *)value;
@end

@implementation SwitchyProtocolOutput
- (instancetype)init {
  self = [super init];
  if (self) _lock = [[NSLock alloc] init];
  return self;
}

- (void)send:(NSDictionary<NSString *, id> *)value {
  if (![NSJSONSerialization isValidJSONObject:value]) return;
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  if (!data) return;
  NSMutableData *line = [data mutableCopy];
  const char newline = '\n';
  [line appendBytes:&newline length:1];
  [self.lock lock];
  [[NSFileHandle fileHandleWithStandardOutput] writeData:line];
  [self.lock unlock];
}
@end

static NSString *SwitchyPermissionName(UNAuthorizationStatus status) {
  switch (status) {
    case UNAuthorizationStatusAuthorized:
    case UNAuthorizationStatusProvisional:
      return @"granted";
    case UNAuthorizationStatusDenied:
      return @"denied";
    case UNAuthorizationStatusNotDetermined:
      return @"not_determined";
  }
  return @"unavailable";
}

@interface SwitchyNotificationDelegate : NSObject <UNUserNotificationCenterDelegate>
@end

@implementation SwitchyNotificationDelegate
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completionHandler {
  completionHandler(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionSound);
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
didReceiveNotificationResponse:(UNNotificationResponse *)response
         withCompletionHandler:(void (^)(void))completionHandler {
  NSString *action = response.actionIdentifier;
  if ([action isEqualToString:UNNotificationDefaultActionIdentifier]
      || [action isEqualToString:SwitchyOpenActionIdentifier]) {
    NSURL *destination = SwitchyLocalURL(
      response.notification.request.content.userInfo[SwitchyDestinationKey]
    );
    if (destination) [[NSWorkspace sharedWorkspace] openURL:destination];
  }
  completionHandler();
}
@end

@interface SwitchyNotificationService : NSObject
@property(nonatomic, strong) UNUserNotificationCenter *center;
@property(nonatomic, strong) SwitchyProtocolOutput *output;
- (instancetype)initWithOutput:(SwitchyProtocolOutput *)output;
- (void)permissionForRequestId:(NSString *)requestId shouldRequest:(BOOL)shouldRequest;
- (void)showForRequestId:(NSString *)requestId command:(NSDictionary<NSString *, id> *)command;
@end

@implementation SwitchyNotificationService
- (instancetype)initWithOutput:(SwitchyProtocolOutput *)output {
  self = [super init];
  if (self) {
    _output = output;
    _center = [UNUserNotificationCenter currentNotificationCenter];
    UNNotificationAction *openAction = [UNNotificationAction
      actionWithIdentifier:SwitchyOpenActionIdentifier
      title:@"Open Switchy"
      options:UNNotificationActionOptionNone];
    UNNotificationCategory *category = [UNNotificationCategory
      categoryWithIdentifier:SwitchyCategoryIdentifier
      actions:@[openAction]
      intentIdentifiers:@[]
      options:UNNotificationCategoryOptionNone];
    [_center setNotificationCategories:[NSSet setWithObject:category]];
  }
  return self;
}

- (void)respond:(NSString *)requestId
        success:(BOOL)success
          extra:(NSDictionary<NSString *, id> *)extra {
  NSMutableDictionary<NSString *, id> *response = [@{
    @"event": @"response",
    @"request_id": requestId,
    @"success": @(success),
  } mutableCopy];
  [response addEntriesFromDictionary:extra ?: @{}];
  [self.output send:response];
}

- (void)currentPermission:(void (^)(NSString *permission))completion {
  [self.center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
    NSString *permission = SwitchyPermissionName(settings.authorizationStatus);
    dispatch_async(dispatch_get_main_queue(), ^{
      completion(permission);
    });
  }];
}

- (void)permissionForRequestId:(NSString *)requestId shouldRequest:(BOOL)shouldRequest {
  [self currentPermission:^(NSString *permission) {
    if (!shouldRequest || ![permission isEqualToString:@"not_determined"]) {
      [self respond:requestId success:YES extra:@{@"permission": permission}];
      return;
    }

    [NSApp activateIgnoringOtherApps:YES];
    [self.center
      requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound)
      completionHandler:^(BOOL granted, NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{
          if (error) {
            [self respond:requestId
                  success:NO
                    extra:@{@"error": error.localizedDescription}];
            return;
          }
          [self currentPermission:^(NSString *updatedPermission) {
            [self respond:requestId
                  success:YES
                    extra:@{@"permission": updatedPermission}];
          }];
        });
      }];
  }];
}

- (void)showForRequestId:(NSString *)requestId command:(NSDictionary<NSString *, id> *)command {
  NSString *identifier = command[@"id"];
  NSString *title = command[@"title"];
  NSString *body = command[@"body"];
  NSURL *destination = SwitchyLocalURL(command[@"url"]);
  if (![identifier isKindOfClass:[NSString class]]
      || ![title isKindOfClass:[NSString class]]
      || ![body isKindOfClass:[NSString class]]
      || !destination) {
    [self respond:requestId
          success:NO
            extra:@{@"error": @"Invalid notification payload"}];
    return;
  }

  [self currentPermission:^(NSString *permission) {
    if (![permission isEqualToString:@"granted"]) {
      [self respond:requestId
            success:NO
              extra:@{
                @"error": [NSString stringWithFormat:@"Notification permission is %@", permission],
                @"permission": permission,
              }];
      return;
    }

    UNMutableNotificationContent *content = [[UNMutableNotificationContent alloc] init];
    content.title = title;
    content.body = body;
    content.sound = [UNNotificationSound defaultSound];
    content.categoryIdentifier = SwitchyCategoryIdentifier;
    content.threadIdentifier = SwitchyThreadIdentifier;
    content.userInfo = @{SwitchyDestinationKey: destination.absoluteString};
    UNNotificationRequest *notification = [UNNotificationRequest
      requestWithIdentifier:identifier
      content:content
      trigger:nil];
    __weak typeof(self) weakSelf = self;
    [self.center addNotificationRequest:notification withCompletionHandler:^(NSError *error) {
      dispatch_async(dispatch_get_main_queue(), ^{
        typeof(self) strongSelf = weakSelf;
        if (!strongSelf) return;
        if (error) {
          [strongSelf respond:requestId
                      success:NO
                        extra:@{@"error": error.localizedDescription}];
        } else {
          [strongSelf respond:requestId
                      success:YES
                        extra:@{@"id": identifier}];
        }
      });
    }];
  }];
}
@end

@interface SwitchyInputReader : NSObject
@property(nonatomic, strong) NSMutableData *buffer;
@property(nonatomic, strong) SwitchyNotificationService *service;
@property(nonatomic, strong) SwitchyProtocolOutput *output;
- (instancetype)initWithService:(SwitchyNotificationService *)service
                         output:(SwitchyProtocolOutput *)output;
- (void)start;
@end

@implementation SwitchyInputReader
- (instancetype)initWithService:(SwitchyNotificationService *)service
                         output:(SwitchyProtocolOutput *)output {
  self = [super init];
  if (self) {
    _buffer = [[NSMutableData alloc] init];
    _service = service;
    _output = output;
  }
  return self;
}

- (void)start {
  NSFileHandle *input = [NSFileHandle fileHandleWithStandardInput];
  __weak typeof(self) weakSelf = self;
  input.readabilityHandler = ^(NSFileHandle *handle) {
    NSData *data = handle.availableData;
    if (data.length == 0) {
      dispatch_async(dispatch_get_main_queue(), ^{
        [NSApp terminate:nil];
      });
      return;
    }
    dispatch_async(dispatch_get_main_queue(), ^{
      [weakSelf consume:data];
    });
  };
}

- (void)consume:(NSData *)data {
  [self.buffer appendData:data];
  const uint8_t *bytes = self.buffer.bytes;
  NSUInteger start = 0;
  for (NSUInteger index = 0; index < self.buffer.length; index += 1) {
    if (bytes[index] != '\n') continue;
    NSData *line = [self.buffer subdataWithRange:NSMakeRange(start, index - start)];
    [self handle:line];
    start = index + 1;
  }
  if (start > 0) [self.buffer replaceBytesInRange:NSMakeRange(0, start) withBytes:NULL length:0];
}

- (void)handle:(NSData *)data {
  if (data.length == 0) return;
  id decoded = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  NSDictionary<NSString *, id> *command =
    [decoded isKindOfClass:[NSDictionary class]] ? decoded : nil;
  NSString *action = command[@"action"];
  NSString *requestId = command[@"request_id"];
  if (![action isKindOfClass:[NSString class]]
      || ![requestId isKindOfClass:[NSString class]]) {
    [self.output send:@{
      @"event": @"protocol_error",
      @"error": @"Invalid helper command",
    }];
    return;
  }

  if ([action isEqualToString:@"permission"]) {
    [self.service permissionForRequestId:requestId
                           shouldRequest:[command[@"request"] boolValue]];
  } else if ([action isEqualToString:@"show"]) {
    [self.service showForRequestId:requestId command:command];
  } else if ([action isEqualToString:@"quit"]) {
    [self.output send:@{
      @"event": @"response",
      @"request_id": requestId,
      @"success": @YES,
    }];
    [NSFileHandle fileHandleWithStandardInput].readabilityHandler = nil;
    [NSApp terminate:nil];
  } else {
    [self.output send:@{
      @"event": @"response",
      @"request_id": requestId,
      @"success": @NO,
      @"error": @"Unknown helper action",
    }];
  }
}
@end

// UNUserNotificationCenter holds its delegate weakly, and the reader is only
// retained by an stdin callback block that captures it weakly. Both need an
// owner that outlives -[NSApplication run].
static SwitchyNotificationDelegate *gNotificationDelegate = nil;
static SwitchyInputReader *gInputReader = nil;

int main(void) {
  @autoreleasepool {
    NSApplication *application = [NSApplication sharedApplication];
    [application setActivationPolicy:NSApplicationActivationPolicyAccessory];

    SwitchyProtocolOutput *output = [[SwitchyProtocolOutput alloc] init];
    SwitchyNotificationService *service = [[SwitchyNotificationService alloc]
      initWithOutput:output];

    gNotificationDelegate = [[SwitchyNotificationDelegate alloc] init];
    [UNUserNotificationCenter currentNotificationCenter].delegate = gNotificationDelegate;

    gInputReader = [[SwitchyInputReader alloc] initWithService:service output:output];
    [gInputReader start];
    [output send:@{@"event": @"ready"}];

    [application run];
  }
  return 0;
}
