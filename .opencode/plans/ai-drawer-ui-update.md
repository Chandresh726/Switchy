# AI Content Drawer UI Update Plan

## Overview
Update the AI content drawer (`ai-content-editor.tsx`) to match the app's established UI aesthetic for both referral messages and cover letters. The drawer layout is good, but needs spacing, border radius, color, and component styling adjustments.

---

## Current Issues Analysis

### 1. Border Radius Inconsistencies
**Current:**
- Content container uses `rounded-lg` (8px radius)
- Buttons have default Shadcn radius (often rounded)
- Textareas have default rounded corners

**App Pattern:**
- All elements use `rounded-none` (sharp corners)
- Only circular avatars/icons use rounding

### 2. Spacing Issues
**Current:**
- Section 1 (Header): `pb-4 pt-5 px-6` - inconsistent padding
- Section 2 (Variant): `px-6 py-3` - too tight
- Section 3 (Content): `px-6 py-3` - inconsistent with card pattern
- Section 4 (Input): `px-6 py-3` - needs more breathing room

**App Pattern:**
- Standard card padding: `p-6` (24px)
- Section dividers with proper spacing
- Consistent gaps between elements: `gap-4` (16px)

### 3. Color and Visual Hierarchy
**Current:**
- Variant selector has `bg-zinc-900/30` which feels disconnected
- User prompt pill has `bg-zinc-900/50` but styling doesn't match app badges
- Content textarea container has `bg-zinc-900 border-zinc-700 rounded-lg`

**App Pattern:**
- Elevated surfaces: `bg-zinc-900/50` with `border-zinc-800`
- Status/info badges: `bg-{color}-500/10 border-{color}-500/30`
- Input containers: `bg-transparent` or `bg-zinc-950/50`

### 4. Button Styling
**Current:**
- Variant nav buttons: `variant="ghost"` with `h-7 w-7`
- Save button: `h-8` with custom bg-emerald classes
- Send button: `h-[50px]` with custom bg-emerald classes
- Close button: ghost variant with custom sizing

**App Pattern:**
- Standard sizes: `size="sm"` (h-7) or `size="xs"` (h-6)
- Icon buttons use `size="icon"` with proper dimensions
- Primary actions: `variant="default"` (emerald)
- Secondary actions: `variant="outline"` with `border-zinc-700`
- Ghost for subtle actions

### 5. Input/Textarea Styling
**Current:**
- Main content textarea: `bg-transparent border-0` but container has border
- Input textarea: `bg-zinc-900 border-zinc-700`
- Heights and sizing don't match app input pattern

**App Pattern:**
- Height: `h-8` for standard inputs, `min-h-[80px]` for textareas
- Background: `bg-transparent` or `bg-zinc-950/50`
- Border: `border-zinc-800`
- Sharp corners: `rounded-none`
- Focus: `focus-visible:ring-0 focus-visible:ring-offset-0`

---

## Proposed Changes

### Section 1: Header
**Current:**
```tsx
<div className="border-b border-zinc-800 pb-4 pt-5 px-6">
  <div className="flex items-start justify-between">
    <div className="flex-1">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
        <TypeIcon className={cn("h-5 w-5", typeConfig.color)} />
        {title}
      </h2>
      <p className="mt-1 text-sm text-zinc-400">{description}</p>
    </div>
    <Button variant="ghost" size="sm" onClick={handleClose}
      className="h-8 w-8 p-0 text-zinc-400 hover:text-white">
      <X className="h-4 w-4" />
    </Button>
  </div>
</div>
```

**Proposed:**
```tsx
<div className="border-b border-zinc-800 p-6">
  <div className="flex items-start justify-between gap-4">
    <div className="flex-1">
      <div className="flex items-center gap-3">
        <div className={cn("p-1.5 rounded-none", typeConfig.bgColor)}>
          <TypeIcon className={cn("h-5 w-5", typeConfig.color)} />
        </div>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
      </div>
      <p className="mt-2 text-sm text-zinc-400">{description}</p>
    </div>
    <Button variant="ghost" size="icon" onClick={handleClose}
      className="h-7 w-7 rounded-none text-zinc-400 hover:text-white">
      <X className="h-4 w-4" />
    </Button>
  </div>
</div>
```

**Changes:**
1. Use `p-6` for consistent padding
2. Add icon container with `typeConfig.bgColor` background
3. Use `size="icon"` for close button with `rounded-none`
4. Add gap between icon and title
5. Better vertical spacing with `mt-2`

### Section 2: Variant Selector
**Current:**
```tsx
<div className="px-6 py-3 border-b border-zinc-800 bg-zinc-900/30">
  <div className="flex items-center gap-4 flex-wrap">
    {/* Variant Navigation */}
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" onClick={() => navigateVariant("prev")}
        className="h-7 w-7 p-0 text-zinc-400 hover:text-white">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-sm text-zinc-500 min-w-[100px] text-center">
        Variant {currentVariantIndex + 1} of {content.history.length}
      </span>
      <Button variant="ghost" size="sm" onClick={() => navigateVariant("next")}
        className="h-7 w-7 p-0 text-zinc-400 hover:text-white">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
    {/* User Prompt */}
    {currentVariant?.userPrompt && (
      <div className="flex-1 min-w-0">
        <div className="text-xs text-zinc-500 bg-zinc-900/50 px-3 py-1.5 rounded inline-flex items-center">
          <span className="text-purple-400 mr-2">Your request:</span>
          <span className="text-zinc-300 truncate">{currentVariant.userPrompt}</span>
        </div>
      </div>
    )}
  </div>
</div>
```

**Proposed:**
```tsx
<div className="px-6 py-4 border-b border-zinc-800">
  <div className="flex items-center gap-4 flex-wrap">
    {/* Variant Navigation */}
    <div className="flex items-center gap-2">
      <Button variant="outline" size="icon" onClick={() => navigateVariant("prev")}
        className="h-7 w-7 rounded-none border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-xs text-zinc-500 min-w-[100px] text-center font-medium">
        Variant {currentVariantIndex + 1} of {content.history.length}
      </span>
      <Button variant="outline" size="icon" onClick={() => navigateVariant("next")}
        className="h-7 w-7 rounded-none border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
    {/* User Prompt */}
    {currentVariant?.userPrompt && (
      <div className="flex-1 min-w-0">
        <div className="text-xs px-2.5 py-1.5 border border-zinc-800 bg-zinc-950/30 inline-flex items-center rounded-none">
          <span className="text-zinc-500 mr-2">Request:</span>
          <span className="text-zinc-300 truncate">{currentVariant.userPrompt}</span>
        </div>
      </div>
    )}
  </div>
</div>
```

**Changes:**
1. Remove `bg-zinc-900/30` - let it blend with drawer background
2. Use `py-4` for better spacing
3. Change nav buttons to `variant="outline"` with `size="icon"`
4. Add `rounded-none` to buttons
5. Update user prompt badge style to match app badges (border, not rounded)
6. Change label from "Your request:" to "Request:" for cleaner look
7. Make variant counter text `text-xs` with `font-medium`

### Section 3: Content Editor
**Current:**
```tsx
<div className="px-6 py-3">
  {isLoading ? (
    <div className="flex items-center justify-center h-[150px]">
      <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      <span className="ml-3 text-zinc-400">Loading content...</span>
    </div>
  ) : (
    <div className="relative">
      {/* Save buttons */}
      <div className="flex items-center gap-2 mb-2">
        {hasChanges && (
          <>
            <Button variant="outline" size="sm" onClick={handleCancelChanges}
              className="h-8 border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500">
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveEdit}
              disabled={isSaving || !editedContent.trim()}
              className="h-8 bg-emerald-600 hover:bg-emerald-500 text-white">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />}
              Save
            </Button>
          </>
        )}
      </div>
      {/* Content */}
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg relative"
        style={{ maxHeight: '300px', overflowY: 'auto', overscrollBehavior: 'contain' }}>
        <Button variant="ghost" size="sm" onClick={handleCopy}
          disabled={isLoading}
          className="absolute top-2 right-2 h-7 w-7 p-0 text-zinc-400 hover:text-white z-10">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
        <Textarea value={editedContent} onChange={handleContentChange}
          className="min-h-[150px] bg-transparent border-0 resize-none text-sm leading-relaxed p-3 focus-visible:ring-0 focus-visible:ring-offset-0"
          disabled={isSaving} />
      </div>
    </div>
  )}
</div>
```

**Proposed:**
```tsx
<div className="px-6 py-4 flex-1 min-h-0">
  {isLoading ? (
    <div className="flex items-center justify-center h-[200px]">
      <Loader2 className={cn("h-6 w-6 animate-spin", typeConfig.color)} />
      <span className="ml-2 text-sm text-zinc-400">Generating content...</span>
    </div>
  ) : (
    <div className="relative flex flex-col h-full">
      {/* Save buttons - aligned right */}
      {hasChanges && (
        <div className="flex items-center justify-end gap-2 mb-3">
          <Button variant="outline" size="sm" onClick={handleCancelChanges}
            className="h-7 rounded-none border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800">
            Cancel
          </Button>
          <Button size="sm" onClick={handleSaveEdit}
            disabled={isSaving || !editedContent.trim()}
            className="h-7 rounded-none">
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Save
          </Button>
        </div>
      )}
      {/* Content Container */}
      <div className="relative flex-1 border border-zinc-800 bg-zinc-950/30 min-h-[200px]">
        <Button variant="ghost" size="icon" onClick={handleCopy}
          disabled={isLoading}
          className="absolute top-2 right-2 h-7 w-7 rounded-none text-zinc-400 hover:text-white z-10">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
        <Textarea value={editedContent} onChange={handleContentChange}
          className="h-full min-h-[200px] bg-transparent border-0 rounded-none resize-none text-sm leading-relaxed p-4 focus-visible:ring-0 focus-visible:ring-offset-0"
          disabled={isSaving} />
      </div>
    </div>
  )}
</div>
```

**Changes:**
1. Use `py-4` and add `flex-1 min-h-0` for proper flex layout
2. Loading state: smaller loader (h-6), type-specific color, better text
3. Save buttons: right-aligned, `h-7`, `rounded-none`, remove explicit bg classes (use default)
4. Content container: change to `border-zinc-800 bg-zinc-950/30`, remove `rounded-lg`
5. Textarea: `h-full`, `min-h-[200px]`, `p-4`, `rounded-none`
6. Copy button: use `size="icon"`, `rounded-none`
7. Make section flex column with proper heights

### Section 4: Input Section
**Current:**
```tsx
<div className="px-6 py-3 border-t border-zinc-800">
  <div className="flex gap-2">
    <Textarea ref={textareaRef} value={modificationPrompt} onChange={(e) => setModificationPrompt(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder="Ask for changes (e.g., 'Make it shorter', 'Use more formal tone')..."
      className="min-h-[50px] bg-zinc-900 border-zinc-700 resize-none text-sm"
      disabled={isSending || isSaving} />
    <Button onClick={handleSendModification}
      disabled={!modificationPrompt.trim() || isSending || isSaving}
      className="bg-emerald-600 hover:bg-emerald-500 h-[50px] px-4">
      {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
    </Button>
  </div>
</div>
```

**Proposed:**
```tsx
<div className="px-6 py-4 border-t border-zinc-800">
  <div className="flex gap-3">
    <Textarea ref={textareaRef} value={modificationPrompt} onChange={(e) => setModificationPrompt(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder="Ask for changes (e.g., 'Make it shorter', 'Use more formal tone')..."
      className="min-h-[60px] bg-transparent border-zinc-800 rounded-none resize-none text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
      disabled={isSending || isSaving} />
    <Button onClick={handleSendModification}
      disabled={!modificationPrompt.trim() || isSending || isSaving}
      className="h-[60px] w-[60px] rounded-none shrink-0">
      {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
    </Button>
  </div>
  <p className="mt-2 text-[10px] text-zinc-500">
    Press Enter to send, Shift+Enter for new line
  </p>
</div>
```

**Changes:**
1. Use `py-4` for consistent spacing
2. Increase gap to `gap-3`
3. Textarea: `min-h-[60px]`, `bg-transparent`, `border-zinc-800`, `rounded-none`
4. Send button: explicit `h-[60px] w-[60px]`, `rounded-none`, remove explicit bg classes
5. Add helper text about keyboard shortcuts (matches app pattern)
6. Add `shrink-0` to button to prevent squishing

### Drawer Panel Container
**Current:**
```tsx
<div ref={drawerRef}
  className={cn(
    "absolute left-0 right-0 bg-zinc-900 border-t border-zinc-800 shadow-2xl pointer-events-auto z-10 transition-transform duration-300 ease-out",
    isVisible ? "translate-y-0" : "translate-y-full"
  )}
  style={{ overscrollBehavior: 'contain', bottom: 0 }}>
```

**Proposed:**
```tsx
<div ref={drawerRef}
  className={cn(
    "absolute left-0 right-0 bg-zinc-950 border-t border-zinc-800 shadow-2xl pointer-events-auto z-10 transition-transform duration-300 ease-out flex flex-col",
    isVisible ? "translate-y-0" : "translate-y-full"
  )}
  style={{ overscrollBehavior: 'contain', bottom: 0, maxHeight: '80vh' }}>
```

**Changes:**
1. Change background from `bg-zinc-900` to `bg-zinc-950` (matches main app background)
2. Add `flex flex-col` for proper content layout
3. Add `maxHeight: '80vh'` to prevent drawer from being too tall

---

## Additional Improvements

### 1. Empty State
When there's no content yet (loading or initial state), the content area feels empty. Consider adding:
- Better loading indicator centered in the space
- Skeleton placeholder for content

### 2. Scroll Behavior
The current scroll containment is good, but we could improve:
- Ensure textarea auto-resizes or has consistent scroll behavior
- Keep copy button visible while scrolling content

### 3. Animation
The drawer animation is good, but we could add:
- Subtle fade-in for content when switching variants
- Loading state transition

---

## Color Scheme for Types

### Referral Message
- Icon: `text-purple-400`
- Icon bg: `bg-purple-500/10`
- Keep existing purple theming

### Cover Letter
- Icon: `text-emerald-400`
- Icon bg: `bg-emerald-500/10`
- Keep existing emerald theming (matches primary action color)

---

## Implementation Checklist

### Phase 1: Layout and Spacing
- [ ] Update header section padding to `p-6`
- [ ] Update variant section padding to `px-6 py-4`
- [ ] Update content section padding to `px-6 py-4` with flex layout
- [ ] Update input section padding to `px-6 py-4`
- [ ] Change drawer background to `bg-zinc-950`
- [ ] Add `flex flex-col` to drawer panel

### Phase 2: Border Radius
- [ ] Remove all `rounded-lg` classes
- [ ] Add `rounded-none` to all buttons
- [ ] Add `rounded-none` to all textareas
- [ ] Add `rounded-none` to badge elements

### Phase 3: Component Styling
- [ ] Add icon container in header with `typeConfig.bgColor`
- [ ] Change variant nav buttons to `variant="outline" size="icon"`
- [ ] Update user prompt badge style
- [ ] Change content container to `border-zinc-800 bg-zinc-950/30`
- [ ] Update copy button to `size="icon"`
- [ ] Update save/cancel buttons styling
- [ ] Update input textarea styling
- [ ] Update send button sizing

### Phase 4: Polish
- [ ] Update loading spinner to use type-specific color
- [ ] Add keyboard shortcut helper text
- [ ] Verify all text sizes match app pattern (`text-xs` for labels, `text-sm` for body)
- [ ] Ensure all gaps use consistent spacing (`gap-2`, `gap-3`, `gap-4`)

---

## Visual Reference

The updated drawer should feel like a natural extension of these app patterns:

**Cards:**
- Border: `border-zinc-800`
- Background: `bg-zinc-900/50` or `bg-zinc-950`
- Padding: `p-6`
- Sharp corners

**Buttons:**
- Primary: Default emerald style
- Secondary: Outline with `border-zinc-700`
- Ghost: For subtle actions
- All with `rounded-none`

**Inputs:**
- Background: `bg-transparent` or `bg-zinc-950/50`
- Border: `border-zinc-800`
- Sharp corners
- Height: `h-8` for standard, flexible for textareas

**Typography:**
- Headings: `text-lg font-semibold`
- Body: `text-sm`
- Labels: `text-xs font-medium`
- Meta: `text-[10px]` or `text-xs text-zinc-500`

---

## Expected Result

After these changes, the AI content drawer will:
1. Use consistent sharp corners throughout
2. Have proper spacing that matches the app's card patterns
3. Use the correct color scheme (zinc grays with type-specific accents)
4. Follow the same button and input styling as the rest of the app
5. Feel cohesive with the overall aesthetic
6. Maintain all existing functionality while looking more polished
