"use server";

import { cookies } from "next/headers";

import {
  SIDEBAR_COLLAPSED_COOKIE,
  SIDEBAR_COOKIE_MAX_AGE,
} from "@/lib/sidebar-preferences";

export async function persistSidebarCollapsedAction(collapsed: boolean) {
  const cookieStore = await cookies();

  if (collapsed) {
    cookieStore.set(SIDEBAR_COLLAPSED_COOKIE, "true", {
      path: "/",
      maxAge: SIDEBAR_COOKIE_MAX_AGE,
      sameSite: "lax",
    });
  } else {
    cookieStore.delete(SIDEBAR_COLLAPSED_COOKIE);
  }
}
