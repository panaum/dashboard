"use client";

import { useEffect, useState } from "react";
import { Clipboard, Radar, Kanban, ArrowRight } from "@/components/icons";

// The portal landing — a glass panel floating over a soft "Spirited Away dusk"
// sky. Auth wall is disabled upstream; the "signed in" pill is presentational.
// The two live doors reuse the existing signed /go/ handoff routes.

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function Home() {
  // Compute the greeting on the client to avoid an SSR/client hour mismatch.
  const [greeting, setGreeting] = useState("Good evening");
  useEffect(() => {
    setGreeting(greetingFor(new Date().getHours()));
  }, []);

  return (
    <main className="portal">
      {/* ── Background (fixed, z-0) ─────────────────────────────── */}
      <div className="sky" aria-hidden="true">
        <div className="sun" />
        <div className="cloud cloud-1" />
        <div className="cloud cloud-2" />
        <div className="cloud cloud-3" />
        <div className="town" />
        <div className="lantern lantern-1" />
        <div className="lantern lantern-2" />
        <div className="lantern lantern-3" />
        <div className="lantern lantern-4" />
        <div className="lantern lantern-5" />
      </div>

      {/* ── Glass panel (z-1) ───────────────────────────────────── */}
      <section className="panel">
        <header className="panel-head rise" style={{ animationDelay: "40ms" }}>
          <span className="greeting">
            {greeting}, <strong>Anaum</strong>
          </span>
          <span className="status-pill">
            <span className="status-dot" />
            signed in
          </span>
        </header>

        <div className="hero">
          <h1 className="hero-title rise" style={{ animationDelay: "110ms" }}>
            The proof lives here
          </h1>
          <p className="hero-sub rise" style={{ animationDelay: "170ms" }}>
            Every check logged, every fix verified.
          </p>
        </div>

        <div className="rows">
          <a
            className="row rise"
            style={{ animationDelay: "240ms" }}
            href="/go/dashboard"
          >
            <span className="tile">
              <Clipboard className="icon" />
            </span>
            <span className="row-body">
              <span className="row-name">Deliverables</span>
              <span className="row-desc">QA checklists, delivery tracking, team ops.</span>
            </span>
            <ArrowRight className="row-arrow" />
          </a>

          <a
            className="row rise"
            style={{ animationDelay: "300ms" }}
            href="/go/linkspy"
          >
            <span className="tile">
              <Radar className="icon" />
            </span>
            <span className="row-body">
              <span className="row-name">LinkSpy</span>
              <span className="row-desc">Broken links, monitoring, production verification.</span>
            </span>
            <ArrowRight className="row-arrow" />
          </a>

          <div className="row row-dormant rise" style={{ animationDelay: "360ms" }}>
            <span className="tile">
              <Kanban className="icon" />
            </span>
            <span className="row-body">
              <span className="row-name">Board</span>
              <span className="row-desc">Issue tracking &amp; developer workflow.</span>
            </span>
            <span className="soon-pill">COMING Q3</span>
          </div>
        </div>
      </section>

      <style jsx>{`
        .portal {
          position: relative;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 28px 20px;
          color: #3a3550;
          overflow: hidden;
        }

        /* ── Sky ───────────────────────────────────────────────── */
        .sky {
          position: fixed;
          inset: 0;
          z-index: 0;
          background: linear-gradient(
            to bottom,
            #d9d3ee 0%,
            #e4dbee 32%,
            #f0dee4 58%,
            #f8e6da 80%,
            #fbeedd 100%
          );
        }

        .sun {
          position: absolute;
          left: 50%;
          bottom: -14%;
          width: 160%;
          height: 620px;
          transform: translateX(-50%);
          background: radial-gradient(
            ellipse 60% 100% at center,
            rgba(255, 236, 205, 0.7) 0%,
            rgba(255, 226, 199, 0.34) 40%,
            rgba(255, 224, 196, 0) 72%
          );
          filter: blur(38px);
        }

        .cloud {
          position: absolute;
          border-radius: 50%;
          filter: blur(34px);
          opacity: 0.55;
          will-change: transform;
        }
        .cloud-1 {
          top: 16%;
          width: 340px;
          height: 120px;
          background: radial-gradient(
            circle,
            rgba(247, 234, 244, 0.9),
            rgba(247, 234, 244, 0)
          );
          animation: drift 78s linear infinite;
        }
        .cloud-2 {
          top: 34%;
          width: 460px;
          height: 150px;
          background: radial-gradient(
            circle,
            rgba(236, 226, 246, 0.85),
            rgba(236, 226, 246, 0)
          );
          animation: drift 96s linear infinite;
          animation-delay: -30s;
        }
        .cloud-3 {
          top: 52%;
          width: 300px;
          height: 110px;
          background: radial-gradient(
            circle,
            rgba(250, 232, 226, 0.8),
            rgba(250, 232, 226, 0)
          );
          animation: drift 64s linear infinite;
          animation-delay: -48s;
        }
        @keyframes drift {
          from {
            transform: translateX(-40vw);
          }
          to {
            transform: translateX(140vw);
          }
        }

        /* Muted lavender-gray town silhouette, faded upward. */
        .town {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 22%;
          background: repeating-linear-gradient(
            90deg,
            rgba(168, 150, 168, 0.5) 0px,
            rgba(168, 150, 168, 0.5) 26px,
            rgba(182, 164, 178, 0.4) 26px,
            rgba(182, 164, 178, 0.4) 34px,
            rgba(158, 142, 162, 0.54) 34px,
            rgba(158, 142, 162, 0.54) 58px,
            rgba(176, 158, 174, 0.36) 58px,
            rgba(176, 158, 174, 0.36) 72px
          );
          filter: blur(1.5px);
          -webkit-mask-image: linear-gradient(
            to top,
            rgba(0, 0, 0, 0.85) 0%,
            rgba(0, 0, 0, 0.4) 55%,
            rgba(0, 0, 0, 0) 100%
          );
          mask-image: linear-gradient(
            to top,
            rgba(0, 0, 0, 0.85) 0%,
            rgba(0, 0, 0, 0.4) 55%,
            rgba(0, 0, 0, 0) 100%
          );
          opacity: 0.32;
        }

        /* Warm lantern glows drifting upward and fading. */
        .lantern {
          position: absolute;
          bottom: 12%;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: radial-gradient(
            circle,
            rgba(255, 214, 158, 0.95),
            rgba(255, 194, 132, 0.2) 60%,
            rgba(255, 194, 132, 0) 72%
          );
          box-shadow: 0 0 16px 6px rgba(255, 206, 150, 0.5);
          opacity: 0;
          will-change: transform, opacity;
        }
        .lantern-1 {
          left: 22%;
          animation: float 20s ease-in-out infinite;
          animation-delay: 0s;
        }
        .lantern-2 {
          left: 38%;
          animation: float 24s ease-in-out infinite;
          animation-delay: -6s;
        }
        .lantern-3 {
          left: 54%;
          animation: float 18s ease-in-out infinite;
          animation-delay: -11s;
        }
        .lantern-4 {
          left: 68%;
          animation: float 26s ease-in-out infinite;
          animation-delay: -3s;
        }
        .lantern-5 {
          left: 80%;
          animation: float 22s ease-in-out infinite;
          animation-delay: -15s;
        }
        @keyframes float {
          0% {
            transform: translateY(0) translateX(0);
            opacity: 0;
          }
          15% {
            opacity: 0.9;
          }
          70% {
            opacity: 0.7;
          }
          100% {
            transform: translateY(-46vh) translateX(18px);
            opacity: 0;
          }
        }

        /* ── Glass panel ───────────────────────────────────────── */
        .panel {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 1200px;
          padding: 88px 72px 90px;
          border-radius: 32px;
          border: 1px solid rgba(255, 255, 255, 0.72);
          background: linear-gradient(
            150deg,
            rgba(255, 255, 255, 0.5),
            rgba(250, 244, 250, 0.34)
          );
          -webkit-backdrop-filter: blur(38px) saturate(155%);
          backdrop-filter: blur(38px) saturate(155%);
          box-shadow: 0 40px 80px -32px rgba(90, 70, 130, 0.34),
            inset 0 1.5px 0 rgba(255, 255, 255, 0.9),
            inset 0 -1px 0 rgba(255, 255, 255, 0.4);
          overflow: hidden;
          animation: panel-float 9s ease-in-out infinite alternate;
        }
        /* The panel breathes on the air — a few pixels, very slow. */
        @keyframes panel-float {
          from {
            transform: translateY(0);
          }
          to {
            transform: translateY(-7px);
          }
        }
        /* Diagonal light-sheen streak, top-left. */
        .panel::before {
          content: "";
          position: absolute;
          top: -60%;
          left: -20%;
          width: 70%;
          height: 160%;
          background: linear-gradient(
            120deg,
            rgba(255, 255, 255, 0.42) 0%,
            rgba(255, 255, 255, 0) 55%
          );
          transform: translateX(0) rotate(8deg);
          pointer-events: none;
          animation: sheen-drift 12s ease-in-out infinite alternate;
        }
        /* The light on the glass shifts almost imperceptibly, like a slow sun. */
        @keyframes sheen-drift {
          from {
            transform: translateX(-8px) rotate(8deg);
            opacity: 0.75;
          }
          to {
            transform: translateX(30px) rotate(8deg);
            opacity: 1;
          }
        }

        .panel-head {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 26px;
        }
        .greeting {
          font-family: var(--font-sans), system-ui, sans-serif;
          font-size: 14px;
          color: #7c7694;
        }
        .greeting strong {
          font-weight: 600;
          color: #5b4fcf;
        }
        .status-pill {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 5px 12px;
          border-radius: 999px;
          font-size: 12.5px;
          font-weight: 500;
          color: #5449be;
          background: rgba(255, 255, 255, 0.45);
          border: 1px solid rgba(255, 255, 255, 0.7);
          -webkit-backdrop-filter: blur(8px);
          backdrop-filter: blur(8px);
          white-space: nowrap;
        }
        .status-dot {
          position: relative;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #1fbe88;
          box-shadow: 0 0 0 3px rgba(31, 190, 136, 0.22);
        }
        /* A calm "live" pulse — a single ring breathing outward, slow. */
        .status-dot::after {
          content: "";
          position: absolute;
          inset: -2px;
          border-radius: 50%;
          border: 1px solid rgba(31, 190, 136, 0.5);
          animation: live-pulse 2.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
          pointer-events: none;
        }
        @keyframes live-pulse {
          0% {
            transform: scale(0.85);
            opacity: 0.65;
          }
          70% {
            transform: scale(2.1);
            opacity: 0;
          }
          100% {
            opacity: 0;
          }
        }

        /* ── Hero ──────────────────────────────────────────────── */
        .hero {
          position: relative;
          margin-bottom: 26px;
        }
        .hero-title {
          font-family: var(--font-serif), Georgia, serif;
          font-weight: 500;
          font-size: 36px;
          line-height: 1.1;
          letter-spacing: -0.02em;
          color: #3a3550;
          margin: 0;
        }
        .hero-sub {
          font-family: var(--font-sans), system-ui, sans-serif;
          font-size: 14.5px;
          color: #7c7694;
          margin: 8px 0 0;
        }

        /* ── Rows ──────────────────────────────────────────────── */
        .rows {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .row {
          display: flex;
          align-items: center;
          gap: 15px;
          padding: 18px;
          border-radius: 17px;
          border: 1px solid rgba(255, 255, 255, 0.55);
          background: rgba(255, 255, 255, 0.28);
          text-decoration: none;
          color: inherit;
          transition: transform 0.28s ease, background 0.28s ease,
            box-shadow 0.28s ease;
        }
        a.row {
          cursor: pointer;
        }
        a.row:hover {
          transform: translateY(-2px);
          background: rgba(255, 255, 255, 0.46);
          box-shadow: 0 16px 32px -18px rgba(90, 70, 130, 0.4);
        }
        .tile {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          width: 46px;
          height: 46px;
          border-radius: 13px;
          color: #5b4fcf;
          background: rgba(255, 255, 255, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.72);
          -webkit-backdrop-filter: blur(10px);
          backdrop-filter: blur(10px);
          transition: transform 0.28s ease;
        }
        .tile :global(.icon) {
          width: 24px;
          height: 24px;
        }
        a.row:hover .tile {
          transform: scale(1.05);
        }
        .row-body {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
          flex: 1;
        }
        .row-name {
          font-family: var(--font-sans), system-ui, sans-serif;
          font-size: 15px;
          font-weight: 600;
          color: #3a3550;
        }
        .row-desc {
          font-family: var(--font-sans), system-ui, sans-serif;
          font-size: 13px;
          color: #7c7694;
        }
        .row :global(.row-arrow) {
          flex-shrink: 0;
          width: 18px;
          height: 18px;
          color: #a49ec2;
          transition: transform 0.28s ease, color 0.28s ease;
        }
        a.row:hover :global(.row-arrow) {
          color: #5b4fcf;
          transform: translateX(3px);
        }

        .row-dormant {
          opacity: 0.5;
        }
        .soon-pill {
          flex-shrink: 0;
          padding: 4px 10px;
          border-radius: 999px;
          font-family: var(--font-sans), system-ui, sans-serif;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.04em;
          color: #5449be;
          background: rgba(255, 255, 255, 0.42);
          border: 1px solid rgba(255, 255, 255, 0.66);
        }

        /* ── Entrance ──────────────────────────────────────────── */
        .rise {
          opacity: 0;
          animation: rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes rise {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .cloud,
          .lantern {
            animation: none;
          }
          .lantern {
            opacity: 0;
          }
          .rise {
            opacity: 1;
            animation: none;
            transform: none;
          }
          .row,
          .tile,
          .row :global(.row-arrow) {
            transition: none;
          }
          .panel {
            animation: none;
          }
          .panel::before {
            animation: none;
          }
          .status-dot::after {
            animation: none;
            opacity: 0;
          }
        }
      `}</style>
    </main>
  );
}
