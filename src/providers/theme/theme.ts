import { Injectable } from "@angular/core";
import { Storage } from "@ionic/storage";

export type AppTheme = "light" | "dark";

const STORAGE_KEY = "app_theme";
const DARK_BODY_CLASS = "dark-theme";

@Injectable()
export class ThemeService {
  currentTheme: AppTheme = "light";

  constructor(private storage: Storage) {}

  init(): Promise<void> {
    return this.storage
      .get(STORAGE_KEY)
      .then((stored: AppTheme | null) => {
        if (stored === "light" || stored === "dark") {
          this.set(stored);
          return;
        }
        const prefersDark =
          typeof window !== "undefined" &&
          typeof window.matchMedia === "function" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches;
        this.set(prefersDark ? "dark" : "light");
      })
      .catch(() => this.set("light"));
  }

  set(theme: AppTheme): void {
    this.currentTheme = theme;
    if (typeof document === "undefined") return;
    if (theme === "dark") {
      document.body.classList.add(DARK_BODY_CLASS);
    } else {
      document.body.classList.remove(DARK_BODY_CLASS);
    }
    this.storage.set(STORAGE_KEY, theme);
  }

  toggle(): void {
    this.set(this.currentTheme === "dark" ? "light" : "dark");
  }

  isDark(): boolean {
    return this.currentTheme === "dark";
  }
}
