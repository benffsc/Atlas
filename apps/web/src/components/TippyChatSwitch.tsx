"use client";

/**
 * TippyChatSwitch — renders ShowcaseTippyChat in showcase mode,
 * real TippyChat otherwise.
 *
 * Checks the body class because this component renders outside of
 * ShowcaseProvider (in layout.tsx, above AppShell).
 */

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { TippyChat } from "@/components/TippyChat";
import { ShowcaseTippyChat } from "@/components/ShowcaseTippyChat";

const STORAGE_KEY = "beacon.presentation_mode";
const BODY_CLASS = "presentation-mode";

export function TippyChatSwitch() {
  const pathname = usePathname();
  const [isShowcase, setIsShowcase] = useState(false);

  useEffect(() => {
    // Initial check
    const check = () => {
      setIsShowcase(document.body.classList.contains(BODY_CLASS));
    };
    check();

    // Watch for body class changes (showcase toggle)
    const observer = new MutationObserver(check);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  if (pathname?.startsWith("/public")) return null;

  return isShowcase ? <ShowcaseTippyChat /> : <TippyChat />;
}
