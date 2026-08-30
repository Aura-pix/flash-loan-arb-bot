"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navigation() {
  const pathname = usePathname();

  const links = [
    { href: "/", label: "Dashboard" },
    { href: "/execute", label: "Execute" },
    { href: "/logs", label: "Logs" },
    { href: "/scanner", label: "Scanner Feed" },
  ];

  return (
    <nav className="flex items-center gap-6 text-sm font-medium">
      {links.map((link) => {
        const isActive = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`transition-colors ${
              isActive 
                ? "text-ink font-bold" 
                : "text-ink-dim hover:text-ink"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
