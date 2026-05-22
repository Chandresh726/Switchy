"use client";

import { ChevronsUpDown, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type ThemeMode = "light" | "dark" | "system";

const THEME_OPTIONS: Array<{
  value: ThemeMode;
  label: string;
  icon: typeof Sun;
}> = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

const collapsedNavButtonClass =
  "flex w-full items-center justify-center rounded-lg px-2 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

function useIsMounted() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

interface ThemeToggleProps {
  collapsed?: boolean;
}

function ExpandedThemeTogglePlaceholder() {
  return (
    <Button
      variant="ghost"
      disabled
      className="h-auto w-full justify-between rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground"
    >
      <span className="flex items-center gap-3">
        <Monitor className="h-5 w-5" />
        Theme
      </span>
      <span className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">System</span>
        <ChevronsUpDown className="h-4 w-4" />
      </span>
    </Button>
  );
}

export function ThemeToggle({ collapsed = false }: ThemeToggleProps) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = useIsMounted();

  if (!mounted) {
    if (collapsed) {
      return (
        <button
          type="button"
          disabled
          aria-label="Theme"
          className={cn(collapsedNavButtonClass, "opacity-50")}
        >
          <Moon className="h-5 w-5 shrink-0" />
        </button>
      );
    }

    return <ExpandedThemeTogglePlaceholder />;
  }

  const currentTheme = (theme as ThemeMode | undefined) ?? "system";
  const selectedOption = THEME_OPTIONS.find((option) => option.value === currentTheme) ?? THEME_OPTIONS[0];
  const CurrentIcon = selectedOption.icon;
  const resolvedThemeLabel = resolvedTheme === "dark" ? "Dark" : resolvedTheme === "light" ? "Light" : null;
  const currentThemeLabel =
    currentTheme === "system" && resolvedThemeLabel
      ? `System (${resolvedThemeLabel})`
      : selectedOption.label;

  if (collapsed) {
    const CYCLE_ORDER: ThemeMode[] = ["system", "light", "dark"];
    const nextTheme = CYCLE_ORDER[(CYCLE_ORDER.indexOf(currentTheme) + 1) % CYCLE_ORDER.length];
    const nextLabel = THEME_OPTIONS.find((o) => o.value === nextTheme)?.label ?? nextTheme;

    return (
      <button
        type="button"
        onClick={() => setTheme(nextTheme)}
        title={`Theme: ${selectedOption.label} — click for ${nextLabel}`}
        aria-label={`Switch theme to ${nextLabel}`}
        className={collapsedNavButtonClass}
      >
        <CurrentIcon className="h-5 w-5 shrink-0" />
      </button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto w-full justify-between rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <span className="flex items-center gap-3">
            <CurrentIcon className="h-5 w-5" />
            Theme
          </span>
          <span className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{currentThemeLabel}</span>
            <ChevronsUpDown className="h-4 w-4" />
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[14.5rem]">
        <DropdownMenuRadioGroup
          value={currentTheme}
          onValueChange={(value) => setTheme(value as ThemeMode)}
        >
          {THEME_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                <span className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  {option.label}
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
