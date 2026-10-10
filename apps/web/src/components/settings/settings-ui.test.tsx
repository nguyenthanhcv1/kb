// @vitest-environment happy-dom
import enCommon from "@kb/i18n/messages/en/common.json";
import enErrors from "@kb/i18n/messages/en/errors.json";
import enSettings from "@kb/i18n/messages/en/settings.json";
import viCommon from "@kb/i18n/messages/vi/common.json";
import viErrors from "@kb/i18n/messages/vi/errors.json";
import viSettings from "@kb/i18n/messages/vi/settings.json";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { profileExample, type Profile } from "@/server/profile";
import { listTimeZones } from "@/server/profile/time-zones";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const actions = vi.hoisted(() => ({ updateMyProfile: vi.fn(), setLocale: vi.fn() }));
vi.mock("@/server/profile/actions", () => actions);

const { ProfileSection } = await import("./profile-section");
const { PreferencesSection } = await import("./preferences-section");
const { LocaleSwitcher } = await import("@/components/layout/locale-switcher");

const messages = {
  vi: { common: viCommon, errors: viErrors, settings: viSettings },
  en: { common: enCommon, errors: enErrors, settings: enSettings },
};

function renderWith(ui: ReactNode, locale: "vi" | "en" = "vi") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={messages[locale]}
      timeZone="Asia/Ho_Chi_Minh"
      now={new Date("2026-09-27T03:04:00Z")}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

const profile: Profile = { ...profileExample, avatarUrl: null };
const timeZones = listTimeZones(new Date("2026-09-27T03:04:00Z"));

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("ProfileSection", () => {
  it("saves a trimmed name and avatar URL, then refreshes the layout", async () => {
    const user = userEvent.setup();
    actions.updateMyProfile.mockResolvedValue({
      ok: true,
      data: { ...profile, fullName: "An", avatarUrl: "https://example.com/a.png" },
    });
    renderWith(<ProfileSection profile={profile} />);

    const name = screen.getByLabelText("Tên hiển thị");
    await user.clear(name);
    await user.type(name, "  An ");
    await user.type(screen.getByLabelText("Địa chỉ ảnh đại diện"), "https://example.com/a.png");
    await user.click(screen.getByRole("button", { name: "Lưu" }));

    expect(actions.updateMyProfile).toHaveBeenCalledWith({
      fullName: "  An ",
      avatarUrl: "https://example.com/a.png",
    });
    expect(await screen.findByText("Đã lưu")).toBeTruthy();
    expect(router.refresh).toHaveBeenCalled();
  });

  it("shows translated field errors and does not call the server", async () => {
    const user = userEvent.setup();
    renderWith(<ProfileSection profile={profile} />, "en");

    await user.type(screen.getByLabelText("Avatar URL"), "javascript:alert(1)");
    const name = screen.getByLabelText("Display name");
    await user.clear(name);
    await user.type(name, "a".repeat(101));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("The display name can be at most 100 characters.")).toBeTruthy();
    expect(
      screen.getByText("Enter an image address starting with http:// or https://."),
    ).toBeTruthy();
    expect(screen.getByLabelText("Avatar URL").getAttribute("aria-invalid")).toBe("true");
    expect(actions.updateMyProfile).not.toHaveBeenCalled();
  });

  it("shows the server error code translated", async () => {
    const user = userEvent.setup();
    actions.updateMyProfile.mockResolvedValue({ ok: false, error: "PROFILE_UPDATE_FAILED" });
    renderWith(<ProfileSection profile={profile} />);
    await user.click(screen.getByRole("button", { name: "Lưu" }));
    expect((await screen.findByRole("alert")).textContent).toBe(viErrors.PROFILE_UPDATE_FAILED);
  });
});

describe("PreferencesSection", () => {
  it("saves language and time zone together", async () => {
    const user = userEvent.setup();
    actions.updateMyProfile.mockResolvedValue({
      ok: true,
      data: { ...profile, locale: "en", timeZone: "Europe/Berlin" },
    });
    renderWith(<PreferencesSection profile={profile} timeZones={timeZones} />);

    expect(screen.getByRole("radio", { name: "Tiếng Việt" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    await user.click(screen.getByRole("radio", { name: "English" }));
    const select = screen.getByLabelText("Múi giờ") as HTMLSelectElement;
    expect(select.value).toBe("Asia/Ho_Chi_Minh");
    expect(screen.getByRole("option", { name: "(GMT+07:00) Asia/Ho Chi Minh" })).toBeTruthy();
    await user.selectOptions(select, "Europe/Berlin");
    await user.click(screen.getByRole("button", { name: "Lưu" }));

    expect(actions.updateMyProfile).toHaveBeenCalledWith({
      locale: "en",
      timeZone: "Europe/Berlin",
    });
    expect(router.refresh).toHaveBeenCalled();
  });

  it("previews the current time in the chosen zone and can use the device zone", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      ...new Intl.DateTimeFormat().resolvedOptions(),
      timeZone: "Asia/Saigon",
    });
    renderWith(
      <PreferencesSection profile={{ ...profile, timeZone: "UTC" }} timeZones={timeZones} />,
      "en",
    );
    expect(screen.getByText(/^Current time in this time zone: .*3:04/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Use this device's time zone" }));
    spy.mockRestore();
    expect((screen.getByLabelText("Time zone") as HTMLSelectElement).value).toBe(
      "Asia/Ho_Chi_Minh",
    );
    expect(screen.getByText(/^Current time in this time zone: .*10:04/)).toBeTruthy();
  });
});

describe("LocaleSwitcher", () => {
  it("saves the chosen language through setLocale, then re-renders", async () => {
    const user = userEvent.setup();
    actions.setLocale.mockResolvedValue({ ok: true, data: { locale: "en", saved: true } });
    renderWith(<LocaleSwitcher />);

    await user.click(screen.getByRole("button", { name: "Đổi ngôn ngữ" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "English" }));

    expect(actions.setLocale).toHaveBeenCalledWith("en");
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });
  it("shows the segmented variant as VI / EN buttons and switches on click", async () => {
    const user = userEvent.setup();
    actions.setLocale.mockResolvedValue({ ok: true, data: { locale: "en", saved: true } });
    renderWith(<LocaleSwitcher variant="segmented" />);

    const group = screen.getByRole("group", { name: "Ngôn ngữ" });
    expect(group.textContent).toBe("VIEN");
    expect(screen.getByRole("button", { name: "Tiếng Việt" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "English" }).getAttribute("aria-pressed")).toBe(
      "false",
    );

    await user.click(screen.getByRole("button", { name: "English" }));
    expect(actions.setLocale).toHaveBeenCalledWith("en");
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });
});
