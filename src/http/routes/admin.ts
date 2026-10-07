import { Hono } from "hono";
import type { Context } from "hono";
import { constantTimeEqual } from "../../shared/crypto";
import type { AppBindings } from "../context";

const adminHtml = String.raw`<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>X投稿くん</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f7f8f5;
        --surface: #ffffff;
        --surface-soft: #eef3ee;
        --line: #d8ded7;
        --text: #1f2520;
        --muted: #657066;
        --accent: #087f78;
        --accent-strong: #075e59;
        --warn: #9a6700;
        --danger: #b42318;
        --ok: #16794c;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-width: 320px;
        background: var(--bg);
        color: var(--text);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      button,
      input,
      select,
      textarea {
        font: inherit;
      }

      .topbar {
        display: grid;
        grid-template-columns: minmax(180px, 1fr) minmax(280px, 560px);
        gap: 16px;
        align-items: center;
        padding: 18px clamp(16px, 4vw, 36px);
        border-bottom: 1px solid var(--line);
        background: var(--surface);
      }

      h1 {
        margin: 0;
        font-size: 22px;
        line-height: 1.2;
        letter-spacing: 0;
      }

      .auth-form {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        gap: 8px;
      }

      .auth-form input {
        min-width: 0;
        height: 40px;
        border: 1px solid var(--line);
        border-radius: 6px;
        padding: 0 12px;
        background: #fbfcfa;
        color: var(--text);
      }

      .button {
        height: 40px;
        border: 1px solid var(--line);
        border-radius: 6px;
        padding: 0 13px;
        background: var(--surface);
        color: var(--text);
        cursor: pointer;
      }

      .button.primary {
        border-color: var(--accent);
        background: var(--accent);
        color: #ffffff;
      }

      .button:hover {
        border-color: var(--accent);
      }

      .button.primary:hover {
        background: var(--accent-strong);
      }

      .button.danger {
        border-color: #e7b8b4;
        color: var(--danger);
      }

      .button.danger:hover {
        border-color: var(--danger);
      }

      .button:disabled {
        cursor: not-allowed;
        opacity: 0.62;
      }

      .button.small {
        height: 32px;
        padding: 0 11px;
        font-size: 13px;
        font-weight: 700;
      }

      main {
        width: min(1180px, 100%);
        margin: 0 auto;
        padding: 22px clamp(14px, 3vw, 28px) 34px;
      }

      .toolbar {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 12px;
        align-items: center;
        margin-bottom: 16px;
      }

      .panel {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--surface);
        margin-bottom: 18px;
      }

      .collapsible-panel > summary {
        cursor: pointer;
        list-style: none;
      }

      .collapsible-panel > summary::-webkit-details-marker {
        display: none;
      }

      .panel-head {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 12px;
        align-items: center;
        padding: 14px;
        border-bottom: 1px solid var(--line);
      }

      .panel-head h2 {
        margin: 0;
        font-size: 16px;
        line-height: 1.3;
        letter-spacing: 0;
      }

      .collapsible-panel > .panel-head {
        border-bottom: 0;
      }

      .collapsible-panel[open] > .panel-head {
        border-bottom: 1px solid var(--line);
      }

      .panel-title-line {
        display: flex;
        min-width: 0;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }

      .panel-subtle {
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
      }

      .summary-pill {
        display: inline-flex;
        align-items: center;
        min-height: 28px;
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 2px 9px;
        color: var(--accent-strong);
        font-size: 12px;
        font-weight: 800;
      }

      .summary-pill::before {
        content: "開く";
      }

      .collapsible-panel[open] .summary-pill::before {
        content: "閉じる";
      }

      .panel-tools {
        display: flex;
        justify-content: flex-end;
        padding: 12px 14px 0;
      }

      .account-form {
        display: grid;
        grid-template-columns: minmax(160px, 1fr) minmax(140px, 0.8fr) minmax(140px, 0.8fr) auto;
        gap: 8px;
        padding: 14px;
        border-bottom: 1px solid var(--line);
      }

      .account-form input {
        min-width: 0;
        height: 40px;
        border: 1px solid var(--line);
        border-radius: 6px;
        padding: 0 12px;
        background: #fbfcfa;
        color: var(--text);
      }

      .status-line {
        min-height: 22px;
        color: var(--muted);
        font-size: 14px;
      }

      .status-line.error {
        color: var(--danger);
      }

      .tabs {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin: 0 0 14px;
      }

      .tab {
        min-height: 36px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: var(--surface);
        padding: 0 12px;
        color: var(--text);
        cursor: pointer;
      }

      .tab[aria-selected="true"] {
        border-color: var(--accent);
        background: var(--surface-soft);
        color: var(--accent-strong);
      }

      .tab[hidden] {
        display: none;
      }

      .date-tabs {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin: -6px 0 14px;
      }

      .date-tab {
        min-height: 32px;
        font-size: 12px;
        font-weight: 700;
      }

      .bulk-approval-bar {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 10px;
        align-items: center;
        margin: -6px 0 14px;
        border: 1px solid #b7d7d2;
        border-radius: 8px;
        background: #eef8f6;
        padding: 9px 10px;
      }

      .bulk-approval-bar[hidden] {
        display: none;
      }

      .bulk-select-all,
      .publication-select {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        cursor: pointer;
      }

      .bulk-select-all {
        color: var(--text);
        font-size: 13px;
        font-weight: 800;
      }

      .bulk-select-all input,
      .publication-select input {
        width: 18px;
        height: 18px;
        margin: 0;
        accent-color: var(--accent-strong);
        cursor: pointer;
      }

      .bulk-select-all input:disabled,
      .publication-select input:disabled {
        cursor: not-allowed;
      }

      .bulk-approval-summary {
        min-width: 0;
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
      }

      .publication-select {
        flex: 0 0 auto;
      }

      .table-wrap {
        overflow-x: auto;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--surface);
      }

      .panel .table-wrap {
        border: 0;
        border-radius: 0;
      }

      table {
        width: 100%;
        min-width: 860px;
        border-collapse: collapse;
        table-layout: fixed;
      }

      th,
      td {
        border-bottom: 1px solid var(--line);
        padding: 12px;
        text-align: left;
        vertical-align: top;
        overflow-wrap: anywhere;
      }

      th {
        background: #f0f4ef;
        color: #404940;
        font-size: 12px;
        font-weight: 700;
      }

      tr:last-child td {
        border-bottom: 0;
      }

      .col-status {
        width: 132px;
      }

      .publication-section {
        margin-bottom: 18px;
      }

      .publication-list {
        display: grid;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .publication-card {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--surface);
        overflow: hidden;
      }

      .publication-card.before {
        box-shadow: inset 3px 0 0 var(--accent);
      }

      .publication-card.posted {
        box-shadow: inset 3px 0 0 var(--ok);
      }

      .publication-card.attention,
      .publication-card.problem {
        box-shadow: inset 3px 0 0 var(--warn);
      }

      .publication-card.cancelled {
        box-shadow: inset 3px 0 0 #7a8793;
      }

      .publication-card-head {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        min-width: 0;
        gap: 8px;
        align-items: center;
        padding: 9px 12px;
        border-bottom: 1px solid var(--line);
        background: #fbfcfa;
      }

      .publication-card-body {
        display: grid;
        gap: 8px;
        padding: 10px 12px 12px;
      }

      .x-preview {
        display: grid;
        gap: 8px;
      }

      .x-thread {
        display: grid;
        gap: 0;
      }

      .x-post {
        display: grid;
        grid-template-columns: 44px minmax(0, 1fr);
        gap: 10px;
        position: relative;
      }

      .x-post + .x-post {
        padding-top: 8px;
      }

      .x-rail {
        display: grid;
        grid-template-rows: 36px minmax(0, 1fr);
        justify-items: center;
      }

      .x-avatar {
        display: grid;
        width: 36px;
        height: 36px;
        place-items: center;
        border-radius: 999px;
        background: #111111;
        color: #ffffff;
        font-size: 14px;
        font-weight: 900;
      }

      .x-connector {
        width: 2px;
        min-height: 14px;
        margin: 6px 0 0;
        background: #d7dde3;
      }

      .x-post:last-child .x-connector {
        display: none;
      }

      .x-post-main {
        min-width: 0;
        padding-bottom: 10px;
      }

      .x-post:not(:last-child) .x-post-main {
        border-bottom: 1px solid #edf1f3;
      }

      .x-post-header {
        display: flex;
        min-width: 0;
        flex-wrap: wrap;
        gap: 4px 7px;
        align-items: center;
        margin-bottom: 3px;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.35;
      }

      .x-author {
        min-width: 0;
        overflow: hidden;
        color: #0f1419;
        font-weight: 800;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .x-handle,
      .x-step-label {
        color: #536471;
      }

      .x-text {
        color: #0f1419;
        font-size: 15px;
        line-height: 1.48;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .x-poll {
        display: grid;
        gap: 7px;
        margin-top: 10px;
      }

      .x-poll-option {
        display: flex;
        min-height: 36px;
        align-items: center;
        justify-content: center;
        border: 1px solid #cfd9de;
        border-radius: 999px;
        padding: 5px 12px;
        color: #0f1419;
        font-size: 14px;
        font-weight: 800;
        line-height: 1.25;
      }

      .x-poll-note,
      .x-post-footer {
        color: #536471;
        font-size: 12px;
        line-height: 1.35;
      }

      .x-media-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 2px;
        overflow: hidden;
        margin-top: 10px;
        border: 1px solid #cfd9de;
        border-radius: 12px;
      }

      .x-media-grid.single {
        grid-template-columns: 1fr;
      }

      .x-media-tile {
        display: grid;
        min-height: 112px;
        place-items: center;
        background: #eef3f7;
        color: #536471;
        font-size: 12px;
        font-weight: 800;
      }

      .x-post-footer {
        display: flex;
        min-width: 0;
        flex-wrap: wrap;
        gap: 4px 10px;
        margin-top: 8px;
      }

      .publication-admin-meta {
        display: flex;
        min-width: 0;
        flex-wrap: wrap;
        gap: 5px 9px;
        padding: 7px 8px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #fbfcfa;
      }

      .publication-editor {
        margin-top: 0;
      }

      .publication-editor[hidden] {
        display: none;
      }

      .card-approval-control {
        display: flex;
        min-width: 0;
        gap: 8px;
        align-items: center;
        justify-content: flex-end;
      }

      .approval-note {
        min-width: 0;
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
        line-height: 1.35;
        white-space: nowrap;
      }

      .publication-edit {
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #fbfcfa;
        padding: 8px;
      }

      .publication-edit-form {
        display: grid;
        gap: 8px;
      }

      .publication-edit-accordion {
        display: grid;
        gap: 8px;
      }

      .publication-edit-accordion > summary {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
        cursor: pointer;
        list-style-position: inside;
      }

      .publication-edit-summary-title {
        color: var(--text);
        font-size: 13px;
        font-weight: 800;
      }

      .publication-edit-summary-meta {
        color: var(--muted);
        font-size: 11px;
        font-weight: 800;
      }

      .publication-edit-body {
        display: grid;
        gap: 8px;
        padding-top: 2px;
      }

      .publication-edit-grid {
        display: grid;
        grid-template-columns: minmax(180px, 0.36fr) minmax(0, 1fr);
        gap: 8px;
        align-items: start;
      }

      .publication-edit-field {
        display: grid;
        gap: 4px;
        min-width: 0;
      }

      .publication-edit-subgrid {
        display: grid;
        gap: 6px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #ffffff;
        padding: 7px 8px;
      }

      .publication-edit-field label,
      .publication-edit-label {
        color: var(--muted);
        font-size: 11px;
        font-weight: 800;
        line-height: 1.3;
      }

      .publication-edit-field label {
        display: grid;
        gap: 4px;
      }

      .publication-edit input,
      .publication-edit textarea {
        width: 100%;
        min-width: 0;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #ffffff;
        color: var(--text);
      }

      .publication-edit [data-editable][readonly] {
        border-color: transparent;
        background: transparent;
      }

      .publication-edit textarea[data-editable][readonly] {
        resize: none;
      }

      .publication-edit.is-editing [data-editable] {
        border-color: var(--line);
        background: #ffffff;
      }

      .publication-edit input {
        height: 34px;
        padding: 0 10px;
      }

      .publication-edit textarea {
        min-height: 92px;
        resize: vertical;
        padding: 8px 10px;
        white-space: pre-wrap;
      }

      .publication-edit textarea.follow-up-text {
        min-height: 74px;
      }

      .poll-options-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
      }

      .publication-edit-note {
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
      }

      .publication-edit-actions {
        display: flex;
        gap: 6px;
        justify-content: flex-end;
      }

      .card-title-row,
      .card-meta-row {
        display: flex;
        min-width: 0;
        flex-wrap: wrap;
        align-items: center;
      }

      .card-title-row {
        gap: 7px;
        flex: 1 1 auto;
      }

      .card-meta-row {
        gap: 5px 9px;
      }

      .card-date {
        color: var(--text);
        font-size: 14px;
        font-weight: 800;
        line-height: 1.25;
        white-space: nowrap;
      }

      .card-step-summary {
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
        line-height: 1.3;
      }

      .compact-meta {
        display: inline-flex;
        min-width: 0;
        max-width: 100%;
        align-items: baseline;
        gap: 4px;
        color: var(--text);
        font-size: 11px;
        line-height: 1.35;
      }

      .compact-meta-label {
        color: var(--muted);
        font-weight: 800;
        white-space: nowrap;
      }

      .compact-meta-value {
        min-width: 0;
        max-width: min(360px, 62vw);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .compact-meta-value.mono {
        font-size: inherit;
      }

      .account-table {
        min-width: 720px;
      }

      .account-table .col-status {
        width: 126px;
      }

      .account-table .col-action {
        width: 190px;
      }

      .client-list {
        display: grid;
        gap: 8px;
        margin: 0;
        padding: 12px;
        list-style: none;
      }

      .client-card {
        border: 1px solid var(--line);
        border-radius: 7px;
        background: #ffffff;
        overflow: hidden;
      }

      .client-card-head,
      .client-card-body {
        display: grid;
        gap: 7px;
        padding: 9px 10px;
      }

      .client-card-head {
        border-bottom: 1px solid var(--line);
        background: #fbfcfa;
      }

      .client-edit-row,
      .permission-edit-row {
        display: grid;
        grid-template-columns: minmax(160px, 1fr) minmax(130px, 0.45fr) auto;
        gap: 7px;
        align-items: center;
      }

      .permission-edit-row {
        grid-template-columns: minmax(170px, 1fr) minmax(150px, 0.55fr) minmax(90px, 0.3fr) auto;
      }

      .client-edit-row input,
      .client-edit-row select,
      .permission-edit-row input,
      .permission-edit-row select {
        min-width: 0;
        height: 34px;
        border: 1px solid var(--line);
        border-radius: 6px;
        padding: 0 10px;
        background: #fbfcfa;
        color: var(--text);
      }

      .scope-details {
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #fbfcfa;
        padding: 6px 8px;
      }

      .scope-details > summary {
        cursor: pointer;
        color: var(--accent-strong);
        font-size: 12px;
        font-weight: 800;
      }

      .scope-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
        gap: 5px 8px;
        margin-top: 7px;
      }

      .scope-option {
        display: inline-flex;
        min-width: 0;
        align-items: center;
        gap: 5px;
        color: var(--text);
        font-size: 12px;
        line-height: 1.35;
      }

      .permission-list {
        display: grid;
        gap: 6px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .inline-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-left: 2px;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        min-height: 22px;
        border-radius: 999px;
        padding: 2px 7px;
        background: #eef3ee;
        color: #384138;
        font-size: 11px;
        font-weight: 700;
        white-space: nowrap;
      }

      .badge.before {
        background: #e8f4f2;
        color: var(--accent-strong);
      }

      .badge.posted {
        background: #e8f5ee;
        color: var(--ok);
      }

      .badge.attention,
      .badge.problem {
        background: #fff2d6;
        color: var(--warn);
      }

      .badge.cancelled {
        background: #eef1f3;
        color: #536471;
      }

      .badge.disabled {
        background: #eeeeee;
        color: var(--muted);
      }

      .mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 12px;
      }

      .muted {
        color: var(--muted);
      }

      .primary-line {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        margin-bottom: 4px;
      }

      .empty {
        padding: 34px 16px;
        text-align: center;
        color: var(--muted);
      }

      .empty-state {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--surface);
        padding: 34px 16px;
        text-align: center;
        color: var(--muted);
      }

      .empty-state.loading-state {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        color: var(--accent-strong);
        font-weight: 800;
      }

      .loading-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid #c9dedb;
        border-top-color: var(--accent);
        border-radius: 999px;
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      @media (max-width: 780px) {
        .topbar,
        .toolbar {
          grid-template-columns: 1fr;
        }

        .auth-form {
          grid-template-columns: 1fr;
        }

        .account-form,
        .panel-head {
          grid-template-columns: 1fr;
        }

        .publication-card-head {
          grid-template-columns: 1fr;
          align-items: stretch;
        }

        .card-approval-control {
          justify-content: flex-end;
        }

        .bulk-approval-bar {
          grid-template-columns: minmax(0, 1fr) auto;
        }

        .bulk-approval-summary {
          grid-column: 1 / -1;
          grid-row: 2;
        }

        .x-post {
          grid-template-columns: 36px minmax(0, 1fr);
          gap: 8px;
        }

        .x-avatar {
          width: 32px;
          height: 32px;
          font-size: 13px;
        }

        .client-edit-row,
        .permission-edit-row,
        .publication-edit-grid,
        .poll-options-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <header class="topbar">
        <h1>X投稿くん</h1>
      <form class="auth-form" id="authForm">
        <input id="apiKey" name="apiKey" type="password" autocomplete="off" placeholder="API key" />
        <button class="button primary" type="submit">接続</button>
        <button class="button" id="forgetKey" type="button">削除</button>
      </form>
    </header>
    <main>
      <section class="toolbar" aria-label="状態">
        <div class="status-line" id="statusLine">未接続</div>
        <button class="button" id="refresh" type="button">更新</button>
      </section>
      <nav class="tabs" aria-label="絞り込み">
        <button class="tab" data-filter="pendingApproval" type="button" aria-selected="true">要確認</button>
        <button class="tab" data-filter="problem" type="button" aria-selected="false">問題あり</button>
        <button class="tab" data-filter="ready" type="button" aria-selected="false">予約済</button>
        <button class="tab" data-filter="cancelled" type="button" aria-selected="false" hidden>キャンセル済み（予定前）</button>
      </nav>
      <nav class="date-tabs" id="dateFilters" aria-label="日付絞り込み"></nav>
      <section class="bulk-approval-bar" id="bulkApprovalBar" aria-label="一括承認" hidden>
        <label class="bulk-select-all">
          <input id="selectVisibleApprovals" type="checkbox" />
          <span>表示中をすべて選択</span>
        </label>
        <span class="bulk-approval-summary" id="bulkApprovalSummary">0件選択</span>
        <button class="button primary small" id="approveSelected" type="button" disabled>選択した投稿を承認</button>
      </section>
      <section class="publication-section" aria-label="投稿一覧">
        <ul class="publication-list" id="rows">
          <li class="empty-state">API keyを入力してください</li>
        </ul>
      </section>
      <details class="panel collapsible-panel" aria-label="Xアカウント">
        <summary class="panel-head">
          <div class="panel-title-line">
            <h2>Xアカウント</h2>
            <span class="panel-subtle" id="accountSummaryMeta">未接続</span>
          </div>
          <span class="summary-pill" aria-hidden="true"></span>
        </summary>
        <div class="panel-tools">
          <button class="button" id="refreshAccounts" type="button">再読込</button>
        </div>
        <form class="account-form" id="accountForm">
          <input id="accountName" name="accountName" type="text" autocomplete="off" required placeholder="表示名" />
          <input id="accountId" name="accountId" type="text" autocomplete="off" placeholder="ID 任意" />
          <input id="accountUsername" name="accountUsername" type="text" autocomplete="off" placeholder="Xユーザー名 任意" />
          <button class="button primary" type="submit">追加</button>
        </form>
        <div class="table-wrap" aria-label="Xアカウント一覧">
          <table class="account-table">
            <thead>
              <tr>
                <th class="col-status">状態</th>
                <th>表示名</th>
                <th>Xユーザー名</th>
                <th>ID</th>
                <th class="col-action">操作</th>
              </tr>
            </thead>
            <tbody id="accountRows">
              <tr><td class="empty" colspan="5">API keyを入力してください</td></tr>
            </tbody>
          </table>
        </div>
      </details>
      <details class="panel collapsible-panel" aria-label="APIクライアント">
        <summary class="panel-head">
          <div class="panel-title-line">
            <h2>APIクライアント</h2>
            <span class="panel-subtle" id="clientSummaryMeta">未接続</span>
          </div>
          <span class="summary-pill" aria-hidden="true"></span>
        </summary>
        <div class="panel-tools">
          <button class="button" id="refreshClients" type="button">再読込</button>
        </div>
        <ul class="client-list" id="clientRows">
          <li class="empty-state">API keyを入力してください</li>
        </ul>
      </details>
    </main>
    <script>
      const keyInput = document.getElementById("apiKey");
      const rows = document.getElementById("rows");
      const accountRows = document.getElementById("accountRows");
      const clientRows = document.getElementById("clientRows");
      const accountForm = document.getElementById("accountForm");
      const accountNameInput = document.getElementById("accountName");
      const accountIdInput = document.getElementById("accountId");
      const accountUsernameInput = document.getElementById("accountUsername");
      const statusLine = document.getElementById("statusLine");
      const accountSummaryMeta = document.getElementById("accountSummaryMeta");
      const clientSummaryMeta = document.getElementById("clientSummaryMeta");
      const dateFilters = document.getElementById("dateFilters");
      const bulkApprovalBar = document.getElementById("bulkApprovalBar");
      const selectVisibleApprovals = document.getElementById("selectVisibleApprovals");
      const bulkApprovalSummary = document.getElementById("bulkApprovalSummary");
      const approveSelectedButton = document.getElementById("approveSelected");
      const refreshButton = document.getElementById("refresh");
      const refreshAccountsButton = document.getElementById("refreshAccounts");
      const refreshClientsButton = document.getElementById("refreshClients");
      const filters = document.querySelectorAll("[data-filter]");
      const approvalGraceSeconds = Number.parseInt("__APPROVAL_GRACE_SECONDS__", 10) || 120;

      const pendingApprovalStatuses = new Set(["DRAFT", "PENDING_APPROVAL"]);
      const readyBeforeStatuses = new Set(["SCHEDULED", "QUEUED", "PUBLISHING", "AWAITING_FOLLOW_UP", "RETRY_SCHEDULED"]);
      const beforeStatuses = new Set([...pendingApprovalStatuses, ...readyBeforeStatuses]);
      const postedStatuses = new Set(["PUBLISHED", "PARTIALLY_PUBLISHED"]);
      const problemStatuses = new Set(["FAILED", "DELIVERY_UNKNOWN", "BLOCKED_POLICY", "REJECTED"]);
      const editablePublicationStatuses = new Set(["DRAFT", "PENDING_APPROVAL", "SCHEDULED"]);
      const cancellablePublicationStatuses = new Set(["DRAFT", "PENDING_APPROVAL", "SCHEDULED", "QUEUED"]);
      const defaultScopes = ["publication:preview", "publication:create", "publication:submit", "publication:read", "publication:update", "publication:cancel", "publication:approve", "publication:reject", "publication:retry", "publication:reconcile", "media:create", "account:read", "account:manage"];
      const aiForbiddenScopes = new Set(["publication:approve", "publication:reject", "publication:reconcile", "publication:retry", "account:manage"]);
      const filterLabels = {
        pendingApproval: "要確認",
        problem: "問題あり",
        ready: "予約済",
        cancelled: "キャンセル済み（予定前）"
      };
      const publicationSourceLabels = {
        initial: "投稿前・問題あり"
      };
      const permissionLevels = [
        { value: 0, label: "0 DENY" },
        { value: 1, label: "1 DRAFT_ONLY" },
        { value: 2, label: "2 HUMAN_APPROVAL_REQUIRED" },
        { value: 3, label: "3 POLICY_BASED_AUTO" }
      ];
      const state = {
        apiKey: localStorage.getItem("xpo_admin_api_key") || "",
        filter: "pendingApproval",
        dateFilter: "all",
        publications: [],
        publicationSources: {
          initial: []
        },
        loadedPublicationSources: new Set(),
        loadingPublicationSources: new Set(),
        publicationLoadPromises: new Map(),
        accounts: [],
        apiClients: [],
        availableScopes: defaultScopes,
        dismissedProblemIds: readStringSet("xpo_dismissed_cancelled_publications"),
        selectedApprovalIds: new Set(),
        bulkApproving: false
      };
      const initialNotice = readInitialNotice();

      keyInput.value = state.apiKey;
      if (state.apiKey) {
        void loadAll(initialNotice);
      } else if (initialNotice) {
        setStatus(initialNotice);
      }

      document.getElementById("authForm").addEventListener("submit", (event) => {
        event.preventDefault();
        state.apiKey = keyInput.value.trim();
        localStorage.setItem("xpo_admin_api_key", state.apiKey);
        void loadAll();
      });

      document.getElementById("forgetKey").addEventListener("click", () => {
        state.apiKey = "";
        keyInput.value = "";
        localStorage.removeItem("xpo_admin_api_key");
        clearPublicationSources();
        state.accounts = [];
        state.apiClients = [];
        setStatus("未接続");
        renderAccounts();
        renderClients();
        render();
      });

      accountForm.addEventListener("submit", (event) => {
        event.preventDefault();
        void createXAccount();
      });
      refreshButton.addEventListener("click", () => void loadAll());
      refreshAccountsButton.addEventListener("click", () => void loadAccounts());
      refreshClientsButton.addEventListener("click", () => void loadApiClients());
      selectVisibleApprovals.addEventListener("change", () => {
        const visibleIds = selectableApprovalIds(currentVisiblePublications());
        for (const publicationId of visibleIds) {
          if (selectVisibleApprovals.checked) {
            state.selectedApprovalIds.add(publicationId);
          } else {
            state.selectedApprovalIds.delete(publicationId);
          }
        }
        render();
      });
      approveSelectedButton.addEventListener("click", () => void approveSelectedPublications());

      filters.forEach((button) => {
        button.addEventListener("click", () => {
          state.filter = button.dataset.filter;
          state.dateFilter = "all";
          state.selectedApprovalIds.clear();
          filters.forEach((candidate) => candidate.setAttribute("aria-selected", String(candidate === button)));
          render();
          void ensurePublicationsForFilter(state.filter);
        });
      });

      dateFilters.addEventListener("click", (event) => {
        const target = event.target;
        const button = target instanceof Element ? target.closest("[data-date-filter]") : null;
        if (!button) {
          return;
        }
        state.dateFilter = button.dataset.dateFilter || "all";
        state.selectedApprovalIds.clear();
        render();
      });

      function readInitialNotice() {
        const params = new URLSearchParams(window.location.search);
        if (params.get("oauth") !== "success") {
          return null;
        }
        const xAccountId = params.get("xAccountId");
        window.history.replaceState(null, "", window.location.pathname);
        return xAccountId ? "X接続が完了しました: " + xAccountId : "X接続が完了しました";
      }

      function readStringSet(key) {
        try {
          const values = JSON.parse(localStorage.getItem(key) || "[]");
          return new Set(Array.isArray(values) ? values.filter((value) => typeof value === "string") : []);
        } catch {
          return new Set();
        }
      }

      function writeStringSet(key, values) {
        localStorage.setItem(key, JSON.stringify(Array.from(values)));
      }

      async function loadAll(successMessage = null) {
        if (!state.apiKey) {
          setStatus("未接続", true);
          clearPublicationSources();
          renderAccounts();
          renderClients();
          render();
          return;
        }
        refreshButton.disabled = true;
        refreshAccountsButton.disabled = true;
        refreshClientsButton.disabled = true;
        setStatus("読み込み中");
        try {
          clearPublicationSources();
          await Promise.all([loadAccounts(false), loadApiClients(false), loadPublicationSource(publicationSourceForFilter(state.filter), false, true)]);
          renderClients();
          setStatus(successMessage || "最終更新 " + formatDate(Date.now()));
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "読み込みに失敗しました", true);
        } finally {
          refreshButton.disabled = false;
          refreshAccountsButton.disabled = false;
          refreshClientsButton.disabled = false;
        }
      }

      async function loadAccounts(updateStatus = true) {
        if (!state.apiKey) {
          setStatus("未接続", true);
          state.accounts = [];
          renderAccounts();
          return;
        }
        refreshAccountsButton.disabled = true;
        if (updateStatus) {
          setStatus("Xアカウントを読み込み中");
        }
        try {
          const response = await fetch("/v1/x/accounts", {
            headers: {
              Authorization: "Bearer " + state.apiKey
            }
          });
          if (!response.ok) {
            const text = await response.text();
            throw new Error(text || response.statusText);
          }
          const data = await response.json();
          state.accounts = Array.isArray(data.accounts) ? data.accounts : [];
          renderAccounts();
          renderClients();
          if (updateStatus) {
            setStatus("Xアカウントを更新しました");
          }
        } catch (error) {
          state.accounts = [];
          renderAccounts();
          renderClients();
          if (updateStatus) {
            setStatus(error instanceof Error ? error.message : "Xアカウントの読み込みに失敗しました", true);
            return;
          }
          throw error;
        } finally {
          refreshAccountsButton.disabled = false;
        }
      }

      async function loadApiClients(updateStatus = true) {
        if (!state.apiKey) {
          setStatus("未接続", true);
          state.apiClients = [];
          renderClients();
          return;
        }
        refreshClientsButton.disabled = true;
        if (updateStatus) {
          setStatus("APIクライアントを読み込み中");
        }
        try {
          const response = await fetch("/v1/api-clients", {
            headers: {
              Authorization: "Bearer " + state.apiKey
            }
          });
          if (!response.ok) {
            const text = await response.text();
            throw new Error(text || response.statusText);
          }
          const data = await response.json();
          state.apiClients = Array.isArray(data.apiClients) ? data.apiClients : [];
          state.availableScopes = Array.isArray(data.availableScopes) ? data.availableScopes : defaultScopes;
          renderClients();
          if (updateStatus) {
            setStatus("APIクライアントを更新しました");
          }
        } catch (error) {
          state.apiClients = [];
          renderClients();
          if (updateStatus) {
            setStatus(error instanceof Error ? error.message : "APIクライアントの読み込みに失敗しました", true);
            return;
          }
          throw error;
        } finally {
          refreshClientsButton.disabled = false;
        }
      }

      function publicationSourceForFilter() {
        return "initial";
      }

      function publicationListUrl() {
        const params = new URLSearchParams();
        params.set("limit", "100");
        params.set("statusGroups", "before,attention");
        params.set("includeProblemDismissals", "true");
        return "/v1/publications?" + params.toString();
      }

      function isPublicationSourceLoaded(source) {
        return state.loadedPublicationSources.has(source);
      }

      function clearPublicationSources() {
        state.publications = [];
        state.publicationSources.initial = [];
        state.selectedApprovalIds.clear();
        state.loadedPublicationSources.clear();
        state.loadingPublicationSources.clear();
        state.publicationLoadPromises.clear();
      }

      function syncPublicationSources() {
        const merged = new Map();
        for (const item of state.publicationSources.initial) {
          const id = item?.publication?.id;
          if (id) {
            merged.set(id, item);
          }
        }
        state.publications = Array.from(merged.values());
      }

      async function ensurePublicationsForFilter(filter) {
        const source = publicationSourceForFilter(filter);
        if (isPublicationSourceLoaded(source) || state.loadingPublicationSources.has(source)) {
          render();
          return;
        }
        await loadPublicationSource(source);
      }

      async function reloadCurrentPublications(updateStatus = true) {
        clearPublicationSources();
        await loadPublicationSource(publicationSourceForFilter(state.filter), updateStatus, true);
      }

      async function refreshPublicationBundle(publicationId) {
        const response = await fetch("/v1/publications/" + encodeURIComponent(publicationId), {
          headers: {
            Authorization: "Bearer " + state.apiKey
          }
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || response.statusText);
        }
        replacePublicationBundle(await response.json());
      }

      function replacePublicationBundle(bundle) {
        const publicationId = bundle?.publication?.id;
        if (!publicationId) {
          throw new Error("更新対象のPublication IDを取得できませんでした");
        }
        let replaced = false;
        for (const source of Object.keys(state.publicationSources)) {
          const items = state.publicationSources[source];
          const index = items.findIndex((item) => item?.publication?.id === publicationId);
          if (index === -1) {
            continue;
          }
          const nextItems = items.slice();
          nextItems[index] = bundle;
          state.publicationSources[source] = nextItems;
          replaced = true;
        }
        if (!replaced) {
          throw new Error("画面上のPublicationを更新できませんでした");
        }
        syncPublicationSources();
        render();
      }

      async function loadPublicationSource(source, updateStatus = true, force = false) {
        if (!state.apiKey) {
          setStatus("未接続", true);
          clearPublicationSources();
          render();
          return;
        }
        if (!force && isPublicationSourceLoaded(source)) {
          render();
          return;
        }
        const existing = state.publicationLoadPromises.get(source);
        if (existing) {
          await existing;
          return;
        }
        refreshButton.disabled = true;
        state.loadingPublicationSources.add(source);
        render();
        if (updateStatus) {
          setStatus((publicationSourceLabels[source] || "投稿") + "を読み込み中");
        }

        const task = (async () => {
          try {
            const response = await fetch(publicationListUrl(), {
              headers: {
                Authorization: "Bearer " + state.apiKey
              }
            });
            if (!response.ok) {
              const text = await response.text();
              throw new Error(text || response.statusText);
            }
            const data = await response.json();
            mergeDismissedProblemIds(data.problemDismissedPublicationIds);
            state.publicationSources[source] = Array.isArray(data.publications) ? data.publications : [];
            state.loadedPublicationSources.add(source);
            syncPublicationSources();
            render();
            if (updateStatus) {
              setStatus((publicationSourceLabels[source] || "投稿") + "を更新しました");
            }
          } catch (error) {
            if (!state.loadedPublicationSources.has(source)) {
              state.publicationSources[source] = [];
              syncPublicationSources();
              render();
            }
            if (updateStatus) {
              setStatus(error instanceof Error ? error.message : "投稿の読み込みに失敗しました", true);
              return;
            }
            throw error;
          } finally {
            state.loadingPublicationSources.delete(source);
            state.publicationLoadPromises.delete(source);
            refreshButton.disabled = false;
            render();
          }
        })();
        state.publicationLoadPromises.set(source, task);
        await task;
      }

      async function createXAccount() {
        state.apiKey = keyInput.value.trim() || state.apiKey;
        if (!state.apiKey) {
          setStatus("API keyを入力してください", true);
          return;
        }
        const name = accountNameInput.value.trim();
        if (!name) {
          setStatus("表示名を入力してください", true);
          return;
        }
        localStorage.setItem("xpo_admin_api_key", state.apiKey);
        setStatus("Xアカウントを追加中");
        const body = {
          name,
          permissionLevel: 3
        };
        const id = accountIdInput.value.trim();
        const username = accountUsernameInput.value.trim();
        if (id) {
          body.id = id;
        }
        if (username) {
          body.xUsername = username.replace(/^@/, "");
        }
        try {
          const response = await fetch("/v1/x/accounts", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + state.apiKey,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
          });
          if (!response.ok) {
            const text = await response.text();
            throw new Error(text || response.statusText);
          }
          const data = await response.json();
          accountNameInput.value = "";
          accountIdInput.value = "";
          accountUsernameInput.value = "";
          await loadAccounts(false);
          await loadApiClients(false);
          setStatus("Xアカウントを追加しました");
          if (data.account?.id) {
            markAccount(data.account.id);
          }
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "Xアカウントの追加に失敗しました", true);
        }
      }

      async function connectXAccount(xAccountId) {
        state.apiKey = keyInput.value.trim() || state.apiKey;
        if (!state.apiKey) {
          setStatus("API keyを入力してください", true);
          return;
        }
        if (!xAccountId) {
          setStatus("Xアカウントを選択してください", true);
          return;
        }
        localStorage.setItem("xpo_admin_api_key", state.apiKey);
        setStatus("X接続URLを作成中");
        try {
          const response = await fetch("/v1/x/oauth/authorize?xAccountId=" + encodeURIComponent(xAccountId) + "&response=json", {
            headers: {
              Authorization: "Bearer " + state.apiKey
            }
          });
          if (!response.ok) {
            const text = await response.text();
            throw new Error(text || response.statusText);
          }
          const data = await response.json();
          if (typeof data.authorizeUrl !== "string") {
            throw new Error("X接続URLを取得できませんでした");
          }
          window.location.href = data.authorizeUrl;
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "X接続に失敗しました", true);
        }
      }

      async function deleteXAccount(account) {
        state.apiKey = keyInput.value.trim() || state.apiKey;
        if (!state.apiKey) {
          setStatus("API keyを入力してください", true);
          return;
        }
        if (!account?.id) {
          setStatus("Xアカウントを選択してください", true);
          return;
        }
        const label = [account.name, account.id].filter(Boolean).join(" / ");
        if (!window.confirm(label + " を削除しますか？")) {
          return;
        }
        localStorage.setItem("xpo_admin_api_key", state.apiKey);
        setStatus("Xアカウントを削除中");
        try {
          const response = await fetch("/v1/x/accounts/" + encodeURIComponent(account.id), {
            method: "DELETE",
            headers: {
              Authorization: "Bearer " + state.apiKey
            }
          });
          if (!response.ok) {
            const text = await response.text();
            throw new Error(text || response.statusText);
          }
          await loadAccounts(false);
          await loadApiClients(false);
          setStatus("Xアカウントを削除しました");
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "Xアカウントの削除に失敗しました", true);
        }
      }

      async function approvePublication(publication, button) {
        state.apiKey = keyInput.value.trim() || state.apiKey;
        if (!state.apiKey) {
          setStatus("API keyを入力してください", true);
          return;
        }
        localStorage.setItem("xpo_admin_api_key", state.apiKey);
        if (button) {
          button.disabled = true;
        }
        setStatus("承認中");
        try {
          await requestPublicationApproval(publication, "Approved from admin UI");
          try {
            await refreshPublicationBundle(publication.id);
            setStatus("承認しました");
          } catch (refreshError) {
            const message = refreshError instanceof Error ? refreshError.message : "表示更新に失敗しました";
            setStatus("承認しましたが、表示を更新できませんでした。更新ボタンで再読み込みしてください: " + message, true);
          }
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "承認に失敗しました", true);
        } finally {
          if (button) {
            button.disabled = false;
          }
        }
      }

      async function approveSelectedPublications() {
        state.apiKey = keyInput.value.trim() || state.apiKey;
        if (!state.apiKey) {
          setStatus("API keyを入力してください", true);
          return;
        }
        const selectedItems = sortPublicationsBySchedule(state.publications).filter((item) => {
          const publication = item?.publication;
          return publication?.id && state.selectedApprovalIds.has(publication.id) && isBulkApprovablePublication(publication);
        });
        if (selectedItems.length === 0) {
          state.selectedApprovalIds.clear();
          render();
          setStatus("承認する投稿を選択してください", true);
          return;
        }
        if (!window.confirm(bulkApprovalConfirmation(selectedItems))) {
          return;
        }

        localStorage.setItem("xpo_admin_api_key", state.apiKey);
        state.bulkApproving = true;
        render();
        let approvedCount = 0;
        const failures = [];
        const refreshFailures = [];
        try {
          for (let index = 0; index < selectedItems.length; index += 1) {
            const publication = selectedItems[index].publication;
            setStatus("一括承認中 " + (index + 1) + "/" + selectedItems.length);
            try {
              await requestPublicationApproval(publication, "Approved in bulk from admin UI");
              approvedCount += 1;
              state.selectedApprovalIds.delete(publication.id);
              try {
                await refreshPublicationBundle(publication.id);
              } catch (refreshError) {
                refreshFailures.push({ publication, error: errorMessage(refreshError, "表示更新に失敗しました") });
              }
            } catch (error) {
              failures.push({ publication, error: errorMessage(error, "承認に失敗しました") });
            }
          }
        } finally {
          state.bulkApproving = false;
          render();
        }

        const resultParts = [approvedCount + "件を承認"];
        if (failures.length > 0) {
          resultParts.push(failures.length + "件失敗");
        }
        if (refreshFailures.length > 0) {
          resultParts.push(refreshFailures.length + "件の表示更新に失敗");
        }
        const details = failures
          .slice(0, 3)
          .map((failure) => shortId(failure.publication.id) + ": " + failure.error)
          .join(" / ");
        const hasError = failures.length > 0 || refreshFailures.length > 0;
        const retryNote = refreshFailures.length > 0 ? " 更新ボタンで再読み込みしてください。" : "";
        setStatus(resultParts.join("、") + "しました。" + retryNote + (details ? " " + details : ""), hasError);
      }

      async function requestPublicationApproval(publication, comment) {
        if (!publication?.id) {
          throw new Error("Publication IDを取得できませんでした");
        }
        if (!publication.revision || !publication.contentHash) {
          throw new Error("承認に必要なrevision/contentHashを取得できませんでした");
        }
        const response = await fetch("/v1/publications/" + encodeURIComponent(publication.id) + "/approve", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + state.apiKey,
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey("admin-approve")
          },
          body: JSON.stringify({
            revision: publication.revision,
            contentHash: publication.contentHash,
            comment
          })
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || response.statusText);
        }
      }

      function bulkApprovalConfirmation(items) {
        const publications = items.map((item) => item.publication);
        const scheduledTimes = publications.map((publication) => Number(publication.scheduledAtMs)).filter(Number.isFinite).sort((left, right) => left - right);
        const firstScheduledAt = scheduledTimes[0];
        const lastScheduledAt = scheduledTimes[scheduledTimes.length - 1];
        const scheduleLabel = firstScheduledAt === undefined
          ? "不明"
          : firstScheduledAt === lastScheduledAt
            ? formatDate(firstScheduledAt)
            : formatDate(firstScheduledAt) + " ～ " + formatDate(lastScheduledAt);
        const accounts = Array.from(new Set(publications.map((publication) => accountNameForPublication(publication))));
        return [
          publications.length + "件をまとめて承認します。",
          "投稿日時: " + scheduleLabel,
          "アカウント: " + accounts.join("、"),
          "承認後は予約投稿の対象になります。続行しますか？"
        ].join("\n");
      }

      function errorMessage(error, fallback) {
        return error instanceof Error ? error.message : fallback;
      }

      async function cancelPublication(publication, button) {
        state.apiKey = keyInput.value.trim() || state.apiKey;
        if (!state.apiKey) {
          setStatus("API keyを入力してください", true);
          return;
        }
        if (!publication?.id) {
          setStatus("Publication IDを取得できませんでした", true);
          return;
        }
        const label = [formatDate(publication.scheduledAtMs), publication.id].filter(Boolean).join(" / ");
        if (!window.confirm(label + " を削除しますか？")) {
          return;
        }
        localStorage.setItem("xpo_admin_api_key", state.apiKey);
        if (button) {
          button.disabled = true;
        }
        setStatus("削除中");
        try {
          const response = await fetch("/v1/publications/" + encodeURIComponent(publication.id) + "/cancel", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + state.apiKey,
              "Idempotency-Key": idempotencyKey("admin-cancel")
            }
          });
          if (!response.ok) {
            const text = await response.text();
            throw new Error(text || response.statusText);
          }
          await reloadCurrentPublications(false);
          setStatus("削除しました");
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "削除に失敗しました", true);
        } finally {
          if (button) {
            button.disabled = false;
          }
        }
      }

      async function editPublication(publication, form, button) {
        state.apiKey = keyInput.value.trim() || state.apiKey;
        if (!state.apiKey) {
          setStatus("API keyを入力してください", true);
          return;
        }
        if (!publication?.id) {
          setStatus("Publication IDを取得できませんでした", true);
          return;
        }
        localStorage.setItem("xpo_admin_api_key", state.apiKey);
        button.disabled = true;
        setStatus("投稿を保存中");
        try {
          const body = publicationPatchBody(publication, form);
          const response = await fetch("/v1/publications/" + encodeURIComponent(publication.id), {
            method: "PATCH",
            headers: {
              Authorization: "Bearer " + state.apiKey,
              "Content-Type": "application/json",
              "Idempotency-Key": idempotencyKey("admin-edit")
            },
            body: JSON.stringify(body)
          });
          if (!response.ok) {
            const text = await response.text();
            throw new Error(text || response.statusText);
          }
          await reloadCurrentPublications(false);
          setStatus("投稿を保存しました。必要な場合は再承認してください");
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "投稿の保存に失敗しました", true);
        } finally {
          button.disabled = false;
        }
      }

      function render() {
        const grouped = groupPublicationsForRows(state.publications);
        normalizeActiveFilter(grouped);
        updateFilterLabels(grouped);
        const currentSource = publicationSourceForFilter(state.filter);
        const currentLoaded = isPublicationSourceLoaded(currentSource);
        const currentLoading = state.loadingPublicationSources.has(currentSource);
        const baseVisible = grouped[state.filter] || [];
        const dateOptions = publicationDateOptions(baseVisible);
        if (state.dateFilter !== "all" && !dateOptions.some((option) => option.key === state.dateFilter)) {
          state.dateFilter = "all";
        }
        renderDateFilters(dateOptions, baseVisible.length);
        const selectedDateOption = dateOptions.find((option) => option.key === state.dateFilter);
        const visible = state.dateFilter === "all" ? baseVisible : baseVisible.filter((item) => publicationMatchesDateOption(item, selectedDateOption));
        renderBulkApprovalControls(visible, currentLoaded && !currentLoading);
        rows.replaceChildren();
        if (!state.apiKey) {
          rows.append(emptyState("API keyを入力してください"));
          return;
        }
        if (!currentLoaded && currentLoading) {
          rows.append(loadingState((publicationSourceLabels[currentSource] || "投稿") + "を読み込み中"));
          return;
        }
        if (!currentLoaded) {
          rows.append(loadPromptForSource(currentSource));
          return;
        }
        if (!visible || visible.length === 0) {
          rows.append(emptyState("表示する投稿はありません"));
          return;
        }
        for (const item of visible) {
          rows.append(publicationCardFor(item));
        }
      }

      function currentVisiblePublications() {
        const grouped = groupPublicationsForRows(state.publications);
        const baseVisible = grouped[state.filter] || [];
        if (state.dateFilter === "all") {
          return baseVisible;
        }
        const selectedDateOption = publicationDateOptions(baseVisible).find((option) => option.key === state.dateFilter);
        return selectedDateOption ? baseVisible.filter((item) => publicationMatchesDateOption(item, selectedDateOption)) : baseVisible;
      }

      function renderBulkApprovalControls(visible, ready) {
        const selectableIds = state.filter === "pendingApproval" && ready ? selectableApprovalIds(visible) : [];
        const selectableSet = new Set(selectableIds);
        for (const publicationId of state.selectedApprovalIds) {
          if (!selectableSet.has(publicationId)) {
            state.selectedApprovalIds.delete(publicationId);
          }
        }
        const selectedCount = state.selectedApprovalIds.size;
        bulkApprovalBar.hidden = selectableIds.length === 0;
        selectVisibleApprovals.checked = selectableIds.length > 0 && selectedCount === selectableIds.length;
        selectVisibleApprovals.indeterminate = selectedCount > 0 && selectedCount < selectableIds.length;
        selectVisibleApprovals.disabled = state.bulkApproving || selectableIds.length === 0;
        bulkApprovalSummary.textContent = selectedCount + "件選択 / 表示中 " + selectableIds.length + "件";
        approveSelectedButton.textContent = state.bulkApproving ? "承認中" : "選択した" + selectedCount + "件を承認";
        approveSelectedButton.disabled = state.bulkApproving || selectedCount === 0;
      }

      function selectableApprovalIds(items) {
        return items
          .map((item) => item?.publication)
          .filter((publication) => isBulkApprovablePublication(publication))
          .map((publication) => publication.id);
      }

      function isBulkApprovablePublication(publication) {
        const approvalState = approvalStateFor(publication);
        return Boolean(publication?.id && publication.revision && publication.contentHash && approvalState && !approvalState.expired);
      }

      function updateFilterLabels(grouped) {
        filters.forEach((button) => {
          const key = button.dataset.filter || "all";
          const label = filterLabels[key] || key;
          const source = publicationSourceForFilter(key);
          const count = Array.isArray(grouped[key]) ? grouped[key].length : 0;
          if (key === "cancelled") {
            button.hidden = count === 0;
          }
          if (isPublicationSourceLoaded(source)) {
            button.textContent = label + " " + count + "件";
            return;
          }
          button.textContent = state.loadingPublicationSources.has(source) ? label + " 読込中" : label;
        });
      }

      function normalizeActiveFilter(grouped) {
        if (state.filter !== "cancelled" || grouped.cancelled.length > 0) {
          return;
        }
        state.filter = "ready";
        state.dateFilter = "all";
        filters.forEach((button) => button.setAttribute("aria-selected", String(button.dataset.filter === state.filter)));
      }

      function emptyState(message) {
        const li = document.createElement("li");
        li.className = "empty-state";
        li.textContent = message;
        return li;
      }

      function loadingState(message) {
        const li = document.createElement("li");
        li.className = "empty-state loading-state";
        const spinner = document.createElement("span");
        spinner.className = "loading-spinner";
        spinner.setAttribute("aria-hidden", "true");
        const text = document.createElement("span");
        text.textContent = message;
        li.append(spinner, text);
        return li;
      }

      function loadPromptForSource(source) {
        const li = document.createElement("li");
        li.className = "empty-state";
        const button = document.createElement("button");
        button.className = "button small";
        button.type = "button";
        button.textContent = (publicationSourceLabels[source] || "投稿") + "を読み込む";
        button.addEventListener("click", () => void loadPublicationSource(source));
        li.append(button);
        return li;
      }

      function renderAccounts() {
        updateAccountSummaryMeta();
        accountRows.replaceChildren();
        if (!state.apiKey) {
          const tr = document.createElement("tr");
          const td = document.createElement("td");
          td.className = "empty";
          td.colSpan = 5;
          td.textContent = "API keyを入力してください";
          tr.append(td);
          accountRows.append(tr);
          return;
        }
        if (state.accounts.length === 0) {
          const tr = document.createElement("tr");
          const td = document.createElement("td");
          td.className = "empty";
          td.colSpan = 5;
          td.textContent = "登録済みのXアカウントはありません";
          tr.append(td);
          accountRows.append(tr);
          return;
        }
        for (const account of state.accounts) {
          accountRows.append(accountRowFor(account));
        }
      }

      function updateAccountSummaryMeta() {
        if (!accountSummaryMeta) {
          return;
        }
        if (!state.apiKey) {
          accountSummaryMeta.textContent = "未接続";
          return;
        }
        accountSummaryMeta.textContent = "登録 " + state.accounts.length + "件";
      }

      function renderClients() {
        updateClientSummaryMeta();
        clientRows.replaceChildren();
        if (!state.apiKey) {
          const li = document.createElement("li");
          li.className = "empty-state";
          li.textContent = "API keyを入力してください";
          clientRows.append(li);
          return;
        }
        if (state.apiClients.length === 0) {
          const li = document.createElement("li");
          li.className = "empty-state";
          li.textContent = "APIクライアントはありません";
          clientRows.append(li);
          return;
        }
        for (const client of state.apiClients) {
          clientRows.append(clientCardFor(client));
        }
      }

      function updateClientSummaryMeta() {
        if (!clientSummaryMeta) {
          return;
        }
        if (!state.apiKey) {
          clientSummaryMeta.textContent = "未接続";
          return;
        }
        clientSummaryMeta.textContent = "登録 " + state.apiClients.length + "件";
      }

      function accountRowFor(account) {
        const tr = document.createElement("tr");
        tr.dataset.accountId = account.id || "";
        const connectButton = document.createElement("button");
        connectButton.className = "button";
        connectButton.type = "button";
        connectButton.textContent = account.status === "ACTIVE" ? "再接続" : "接続";
        connectButton.addEventListener("click", () => void connectXAccount(account.id));
        const deleteButton = document.createElement("button");
        deleteButton.className = "button danger";
        deleteButton.type = "button";
        deleteButton.textContent = "削除";
        deleteButton.addEventListener("click", () => void deleteXAccount(account));
        const actions = document.createElement("div");
        actions.className = "inline-actions";
        actions.append(connectButton, deleteButton);
        const actionTd = document.createElement("td");
        actionTd.append(actions);
        tr.append(
          cellWithBadge(account.status || "UNKNOWN"),
          textCell(account.name || ""),
          textCell(account.x_username || account.xUsername || "", "mono"),
          textCell(account.id || "", "mono"),
          actionTd
        );
        return tr;
      }

      function clientCardFor(client) {
        const card = document.createElement("li");
        card.className = "client-card";
        card.title = client.id ? "Client ID: " + client.id : "";
        const head = document.createElement("div");
        head.className = "client-card-head";
        const titleRow = document.createElement("div");
        titleRow.className = "card-title-row";
        const name = document.createElement("span");
        name.className = "card-date";
        name.textContent = client.name || client.id || "API Client";
        titleRow.append(badgeInline(client.actorType || "UNKNOWN"), badgeInline(client.status || "UNKNOWN"), name);
        const meta = document.createElement("div");
        meta.className = "card-meta-row";
        meta.append(
          compactMeta("ID", shortId(client.id), "mono", client.id),
          compactMeta("Prefix", client.keyPrefix || "—", "mono"),
          compactMeta("Last", formatDate(client.lastUsedAtMs))
        );
        head.append(titleRow, meta);

        const body = document.createElement("div");
        body.className = "client-card-body";
        body.append(clientEditForm(client));
        const permissionList = document.createElement("ul");
        permissionList.className = "permission-list";
        const permissions = Array.isArray(client.permissions) ? client.permissions : [];
        for (const permission of permissions) {
          const item = document.createElement("li");
          item.append(permissionEditForm(client, permission, false));
          permissionList.append(item);
        }
        const addItem = document.createElement("li");
        addItem.append(permissionEditForm(client, null, true));
        permissionList.append(addItem);
        body.append(permissionList);
        card.append(head, body);
        return card;
      }

      function clientEditForm(client) {
        const form = document.createElement("form");
        form.dataset.clientId = client.id || "";
        const row = document.createElement("div");
        row.className = "client-edit-row";
        const nameInput = document.createElement("input");
        nameInput.name = "name";
        nameInput.type = "text";
        nameInput.value = client.name || "";
        nameInput.placeholder = "名前";
        const statusSelect = document.createElement("select");
        statusSelect.name = "status";
        appendOptions(statusSelect, [
          { value: "ACTIVE", label: "ACTIVE" },
          { value: "DISABLED", label: "DISABLED" }
        ], client.status || "ACTIVE");
        const button = document.createElement("button");
        button.className = "button primary small";
        button.type = "submit";
        button.textContent = "保存";
        row.append(nameInput, statusSelect, button);
        form.append(row, scopeDetailsFor(client));
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          void updateApiClient(client, form, button);
        });
        return form;
      }

      function scopeDetailsFor(client) {
        const details = document.createElement("details");
        details.className = "scope-details";
        const selectedScopes = new Set(Array.isArray(client.scopes) ? client.scopes : []);
        const summary = document.createElement("summary");
        summary.textContent = "Scope " + selectedScopes.size + "件";
        const grid = document.createElement("div");
        grid.className = "scope-grid";
        for (const scope of state.availableScopes) {
          const label = document.createElement("label");
          label.className = "scope-option";
          const input = document.createElement("input");
          input.type = "checkbox";
          input.name = "scope";
          input.value = scope;
          input.checked = selectedScopes.has(scope);
          input.disabled = client.actorType === "AI" && aiForbiddenScopes.has(scope) && !selectedScopes.has(scope);
          const text = document.createElement("span");
          text.textContent = scope;
          label.append(input, text);
          grid.append(label);
        }
        details.append(summary, grid);
        return details;
      }

      function permissionEditForm(client, permission, isNew) {
        const form = document.createElement("form");
        form.className = "permission-edit-row";
        form.dataset.clientId = client.id || "";
        if (permission?.xAccountId) {
          form.dataset.xAccountId = permission.xAccountId;
        }
        const accountSelect = document.createElement("select");
        accountSelect.name = "xAccountId";
        appendAccountOptions(accountSelect, permission);
        accountSelect.value = permission?.xAccountId || state.accounts[0]?.id || "";
        accountSelect.disabled = !isNew;
        const levelSelect = document.createElement("select");
        levelSelect.name = "permissionLevel";
        appendOptions(levelSelect, permissionLevels, String(permission?.permissionLevel ?? 2));
        const maxInput = document.createElement("input");
        maxInput.name = "maxThreadParts";
        maxInput.type = "number";
        maxInput.min = "1";
        maxInput.max = "25";
        maxInput.step = "1";
        maxInput.value = String(permission?.maxThreadParts || 10);
        const button = document.createElement("button");
        button.className = "button small";
        button.type = "submit";
        button.textContent = isNew ? "追加" : "保存";
        button.disabled = isNew && state.accounts.length === 0;
        form.append(accountSelect, levelSelect, maxInput, button);
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          void updateClientPermission(client, form, button);
        });
        return form;
      }

      async function updateApiClient(client, form, button) {
        state.apiKey = keyInput.value.trim() || state.apiKey;
        if (!state.apiKey) {
          setStatus("API keyを入力してください", true);
          return;
        }
        if (!client?.id) {
          setStatus("Client IDを取得できませんでした", true);
          return;
        }
        const scopes = Array.from(form.querySelectorAll('input[name="scope"]:checked')).map((input) => input.value);
        const body = {
          name: form.elements.name.value.trim(),
          status: form.elements.status.value,
          scopes
        };
        localStorage.setItem("xpo_admin_api_key", state.apiKey);
        button.disabled = true;
        setStatus("APIクライアントを保存中");
        try {
          const response = await fetch("/v1/api-clients/" + encodeURIComponent(client.id), {
            method: "PATCH",
            headers: {
              Authorization: "Bearer " + state.apiKey,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
          });
          if (!response.ok) {
            const text = await response.text();
            throw new Error(text || response.statusText);
          }
          await loadApiClients(false);
          setStatus("APIクライアントを保存しました");
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "APIクライアントの保存に失敗しました", true);
        } finally {
          button.disabled = false;
        }
      }

      async function updateClientPermission(client, form, button) {
        state.apiKey = keyInput.value.trim() || state.apiKey;
        if (!state.apiKey) {
          setStatus("API keyを入力してください", true);
          return;
        }
        const clientId = client?.id;
        const xAccountId = form.dataset.xAccountId || form.elements.xAccountId.value;
        if (!clientId || !xAccountId) {
          setStatus("ClientとXアカウントを選択してください", true);
          return;
        }
        const body = {
          permissionLevel: Number(form.elements.permissionLevel.value),
          maxThreadParts: Number(form.elements.maxThreadParts.value)
        };
        localStorage.setItem("xpo_admin_api_key", state.apiKey);
        button.disabled = true;
        setStatus("権限を保存中");
        try {
          const response = await fetch(
            "/v1/api-clients/" + encodeURIComponent(clientId) + "/permissions/" + encodeURIComponent(xAccountId),
            {
              method: "PATCH",
              headers: {
                Authorization: "Bearer " + state.apiKey,
                "Content-Type": "application/json"
              },
              body: JSON.stringify(body)
            }
          );
          if (!response.ok) {
            const text = await response.text();
            throw new Error(text || response.statusText);
          }
          await loadApiClients(false);
          setStatus("権限を保存しました");
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "権限の保存に失敗しました", true);
        } finally {
          button.disabled = false;
        }
      }

      function publicationCardFor(item) {
        const publication = item.publication || {};
        const activePlan = findActivePlan(item);
        const entries = stepEntriesFor(item);
        const primary = entries.find((entry) => entry.step?.stepType === "MAIN") || entries[0] || { publication, activePlan, step: null, sequence: 1, total: 1 };
        const primaryStatus = entryStatus(primary);
        const editable = canEditPublication(publication, entries);
        const card = document.createElement("li");
        const rowCategory = publicationRowCategory(item);
        const cardType =
          rowCategory === "pendingApproval" || rowCategory === "ready"
            ? "before"
            : rowCategory === "problem"
              ? "problem"
              : rowCategory === "cancelled"
                ? "cancelled"
                : badgeType(primaryStatus);
        card.className = ["publication-card", cardType].filter(Boolean).join(" ");
        if (publication.id) {
          card.title = "Publication ID: " + publication.id;
        }

        const head = document.createElement("div");
        head.className = "publication-card-head";
        const titleRow = document.createElement("div");
        titleRow.className = "card-title-row";
        const date = document.createElement("span");
        date.className = "card-date";
        date.textContent = stepDateFor(primary);
        const summary = document.createElement("span");
        summary.className = "card-step-summary";
        summary.textContent = publicationStepSummary(entries);
        const approvalSelection = approvalSelectionFor(publication);
        if (approvalSelection) {
          titleRow.append(approvalSelection);
        }
        titleRow.append(badgeInline(primaryStatus), date, summary);
        const actions = document.createElement("div");
        actions.className = "inline-actions";
        if (editable) {
          const editButton = document.createElement("button");
          editButton.className = "button small";
          editButton.type = "button";
          editButton.textContent = "編集";
          editButton.addEventListener("click", () => openPublicationEditor(card));
          actions.append(editButton);
        }
        if (canCancelPublication(publication, entries)) {
          const deleteButton = document.createElement("button");
          deleteButton.className = "button danger small";
          deleteButton.type = "button";
          deleteButton.textContent = "削除";
          deleteButton.addEventListener("click", () => void cancelPublication(publication, deleteButton));
          actions.append(deleteButton);
        }
        if (canDismissProblemPublication(publication, entries)) {
          const dismissButton = document.createElement("button");
          dismissButton.className = "button small";
          dismissButton.type = "button";
          dismissButton.textContent = "確認済み";
          dismissButton.addEventListener("click", () => void dismissProblemPublication(publication, dismissButton));
          actions.append(dismissButton);
        }
        if (actions.children.length > 0) {
          titleRow.append(actions);
        }
        head.append(titleRow);
        const approvalControl = approvalControlFor(publication);
        if (approvalControl) {
          head.append(approvalControl);
        }

        const body = document.createElement("div");
        body.className = "publication-card-body";
        body.append(publicationPreviewPanel(item, entries));
        if (editable) {
          const editor = publicationEditPanel(publication, entries, true);
          editor.hidden = true;
          body.append(editor);
        }

        card.append(head, body);
        return card;
      }

      function approvalSelectionFor(publication) {
        if (state.filter !== "pendingApproval" || !isBulkApprovablePublication(publication)) {
          return null;
        }
        const label = document.createElement("label");
        label.className = "publication-select";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = state.selectedApprovalIds.has(publication.id);
        checkbox.disabled = state.bulkApproving;
        checkbox.setAttribute("aria-label", "一括承認の対象に選択: " + formatDate(publication.scheduledAtMs));
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) {
            state.selectedApprovalIds.add(publication.id);
          } else {
            state.selectedApprovalIds.delete(publication.id);
          }
          render();
        });
        label.append(checkbox);
        return label;
      }

      function publicationPreviewPanel(item, entries) {
        const publication = item.publication || {};
        const activePlan = findActivePlan(item);
        const panel = document.createElement("article");
        panel.className = "x-preview";
        panel.dataset.role = "publication-preview";

        const thread = document.createElement("div");
        thread.className = "x-thread";
        for (const entry of [...entries].sort((left, right) => left.sequence - right.sequence)) {
          thread.append(xPostPreviewFor(entry));
        }

        const meta = document.createElement("div");
        meta.className = "publication-admin-meta";
        meta.append(compactMeta("Publication", shortId(publication.id || "—"), "mono", publication.id || "—"));
        meta.append(compactMeta("Account", shortId(publication.xAccountId || "—"), "mono", publication.xAccountId || "—"));
        meta.append(...memoCompactMeta(publication.request?.memo));
        for (const xPostId of entries.map((entry) => entry.step?.xPostId).filter(Boolean)) {
          meta.append(compactMeta("X", shortId(xPostId), "mono", xPostId));
        }
        const poll = entries.find((entry) => entry.step?.poll)?.step?.poll || firstStepPoll(activePlan);
        if (poll?.durationMinutes) {
          meta.append(compactMeta("投票期間", formatDurationMinutes(poll.durationMinutes)));
        }

        panel.append(thread, meta);
        return panel;
      }

      function xPostPreviewFor(entry) {
        const publication = entry.publication || {};
        const step = entry.step || null;
        const post = document.createElement("div");
        post.className = "x-post";

        const rail = document.createElement("div");
        rail.className = "x-rail";
        const avatar = document.createElement("div");
        avatar.className = "x-avatar";
        avatar.textContent = accountAvatarText(publication);
        const connector = document.createElement("div");
        connector.className = "x-connector";
        rail.append(avatar, connector);

        const main = document.createElement("div");
        main.className = "x-post-main";
        const header = document.createElement("div");
        header.className = "x-post-header";
        const author = document.createElement("span");
        author.className = "x-author";
        author.textContent = accountNameForPublication(publication);
        const handle = document.createElement("span");
        handle.className = "x-handle";
        handle.textContent = accountHandleForPublication(publication);
        header.append(author, handle);
        if (entry.total > 1) {
          const stepInfo = document.createElement("span");
          stepInfo.className = "x-step-label";
          stepInfo.textContent = "· " + stepLabel(entry);
          header.append(stepInfo);
        }

        const text = document.createElement("div");
        text.className = "x-text";
        text.textContent = step?.text || publication.request?.content?.text || "";
        main.append(header, text);

        if (step?.poll) {
          main.append(xPollPreview(step.poll));
        }
        if (Array.isArray(step?.mediaIds) && step.mediaIds.length > 0) {
          main.append(xMediaPreview(step.mediaIds));
        }

        const footer = document.createElement("div");
        footer.className = "x-post-footer";
        if (step?.xPostId) {
          footer.append(compactFooterText("X " + shortId(step.xPostId)));
        }
        if (step?.triggerType && step.triggerType !== "AT_PUBLICATION_TIME") {
          footer.append(compactFooterText(triggerLabel(step)));
        }
        if (footer.children.length > 0) {
          main.append(footer);
        }

        post.append(rail, main);
        return post;
      }

      function xPollPreview(poll) {
        const wrapper = document.createElement("div");
        wrapper.className = "x-poll";
        for (const option of poll.options || []) {
          const item = document.createElement("div");
          item.className = "x-poll-option";
          item.textContent = option;
          wrapper.append(item);
        }
        if (poll.durationMinutes) {
          const note = document.createElement("div");
          note.className = "x-poll-note";
          note.textContent = "投票期間 " + formatDurationMinutes(poll.durationMinutes);
          wrapper.append(note);
        }
        return wrapper;
      }

      function xMediaPreview(mediaIds) {
        const grid = document.createElement("div");
        grid.className = ["x-media-grid", mediaIds.length === 1 ? "single" : ""].filter(Boolean).join(" ");
        mediaIds.slice(0, 4).forEach((mediaId, index) => {
          const tile = document.createElement("div");
          tile.className = "x-media-tile";
          tile.textContent = "画像 " + (index + 1) + " / " + shortId(mediaId);
          grid.append(tile);
        });
        return grid;
      }

      function compactFooterText(value) {
        const item = document.createElement("span");
        item.textContent = value;
        return item;
      }

      function openPublicationEditor(card) {
        const preview = card.querySelector("[data-role='publication-preview']");
        const editor = card.querySelector("[data-role='publication-editor']");
        if (!editor) {
          return;
        }
        if (preview) {
          preview.hidden = false;
        }
        editor.hidden = false;
        setPublicationFormEditing(editor, true);
        const accordion = editor.querySelector("[data-role='publication-edit-accordion']");
        if (accordion) {
          accordion.open = false;
          accordion.scrollIntoView({ block: "nearest" });
          const summary = accordion.querySelector("summary");
          if (summary) {
            summary.focus();
          }
        }
      }

      function closePublicationEditor(form) {
        const card = form.closest(".publication-card");
        const preview = card?.querySelector("[data-role='publication-preview']");
        const accordion = form.querySelector("[data-role='publication-edit-accordion']");
        form.reset();
        setPublicationFormEditing(form, true);
        if (accordion) {
          accordion.open = false;
        }
        form.hidden = true;
        if (preview) {
          preview.hidden = false;
        }
      }

      function markAccount(xAccountId) {
        const target = Array.from(accountRows.querySelectorAll("tr")).find((row) => row.dataset.accountId === xAccountId);
        if (target) {
          target.scrollIntoView({ block: "nearest" });
        }
      }

      function groupPublicationsForRows(items) {
        const sorted = sortPublicationsBySchedule(items);
        return {
          pendingApproval: sorted.filter((item) => publicationRowCategory(item) === "pendingApproval"),
          problem: sorted.filter((item) => publicationRowCategory(item) === "problem"),
          ready: sorted.filter((item) => publicationRowCategory(item) === "ready"),
          cancelled: sorted.filter((item) => publicationRowCategory(item) === "cancelled")
        };
      }

      function publicationRowCategory(item) {
        const publication = item.publication || {};
        if (publication.status === "CANCELLED") {
          return isFutureCancelledPublication(publication) ? "cancelled" : "hidden";
        }
        const entries = stepEntriesFor(item);
        if (entries.some((entry) => stepCategory(entry) === "problem")) {
          return "problem";
        }
        if (entries.some((entry) => stepCategory(entry) === "pendingApproval")) {
          return "pendingApproval";
        }
        if (entries.some((entry) => stepCategory(entry) === "ready")) {
          return "ready";
        }
        return "hidden";
      }

      function renderDateFilters(options, total) {
        dateFilters.replaceChildren();
        if (!state.apiKey || total === 0) {
          return;
        }
        dateFilters.append(dateFilterButton("all", "全日付", total));
        for (const option of options) {
          dateFilters.append(dateFilterButton(option.key, option.label, option.count));
        }
      }

      function dateFilterButton(key, label, count) {
        const button = document.createElement("button");
        button.className = "tab date-tab";
        button.type = "button";
        button.dataset.dateFilter = key;
        button.setAttribute("aria-selected", String(state.dateFilter === key));
        button.textContent = label + " " + count;
        return button;
      }

      function publicationDateOptions(items) {
        const countsByDate = new Map();
        for (const item of items) {
          const key = publicationDateKey(item);
          countsByDate.set(key, (countsByDate.get(key) || 0) + 1);
        }
        const entries = Array.from(countsByDate.entries()).sort(([left], [right]) => left.localeCompare(right));
        if (state.filter !== "posted") {
          return entries.map(([key, count]) => ({
            key,
            count,
            label: publicationDateLabel(key)
          }));
        }
        const latestFirst = [...entries].sort(([left], [right]) => right.localeCompare(left));
        const recent = latestFirst.slice(0, 5).map(([key, count]) => ({
          key,
          count,
          label: publicationDateLabel(key)
        }));
        const older = latestFirst.slice(5);
        if (older.length > 0) {
          recent.push({
            key: "older",
            count: older.reduce((sum, [, count]) => sum + count, 0),
            label: "それより過去",
            keys: older.map(([key]) => key)
          });
        }
        return recent;
      }

      function publicationMatchesDateOption(item, option) {
        if (!option) {
          return false;
        }
        const key = publicationDateKey(item);
        if (Array.isArray(option.keys)) {
          return option.keys.includes(key);
        }
        return key === option.key;
      }

      function sortPublicationsBySchedule(items) {
        return [...items].sort((left, right) => publicationScheduleMs(left) - publicationScheduleMs(right));
      }

      function publicationScheduleMs(item) {
        const publication = item.publication || {};
        const value = Number(publication.scheduledAtMs || publication.createdAtMs || 0);
        return Number.isFinite(value) ? value : 0;
      }

      function publicationDateKey(item) {
        const value = publicationScheduleMs(item);
        if (!value) {
          return "unknown";
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
          return "unknown";
        }
        return [date.getFullYear(), pad2(date.getMonth() + 1), pad2(date.getDate())].join("-");
      }

      function publicationDateLabel(key) {
        if (key === "unknown") {
          return "日付なし";
        }
        const parts = key.split("-");
        if (parts.length !== 3) {
          return key;
        }
        return Number(parts[1]) + "/" + Number(parts[2]);
      }

      function canCancelPublication(publication, entries) {
        if (!publication?.id || !cancellablePublicationStatuses.has(publication.status)) {
          return false;
        }
        if (publication.rootPublishedAtMs || publication.completedAtMs) {
          return false;
        }
        return entries.every((entry) => !entry.step?.xPostId && !entry.step?.publishedAtMs);
      }

      function canDismissProblemPublication(publication, entries) {
        return publication?.id && publication.status !== "CANCELLED" && entries.some(isProblemEntry) && !isDismissedProblem(publication);
      }

      async function dismissProblemPublication(publication, button) {
        if (!publication?.id) {
          return;
        }
        button.disabled = true;
        try {
          const response = await fetch("/v1/publications/" + encodeURIComponent(publication.id) + "/problem-dismissal", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + state.apiKey,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({})
          });
          if (!response.ok) {
            const text = await response.text();
            throw new Error(text || response.statusText);
          }
          state.dismissedProblemIds.add(publication.id);
          writeStringSet("xpo_dismissed_cancelled_publications", state.dismissedProblemIds);
          render();
          setStatus("問題ありを確認済みにしました");
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "問題ありの確認済み保存に失敗しました", true);
        } finally {
          button.disabled = false;
        }
      }

      function mergeDismissedProblemIds(publicationIds) {
        if (!Array.isArray(publicationIds)) {
          return;
        }
        for (const publicationId of publicationIds) {
          if (typeof publicationId === "string" && publicationId) {
            state.dismissedProblemIds.add(publicationId);
          }
        }
      }

      function isDismissedProblem(publication) {
        return publication?.id && state.dismissedProblemIds.has(publication.id);
      }

      function canEditPublication(publication, entries) {
        if (!publication?.id || !editablePublicationStatuses.has(publication.status)) {
          return false;
        }
        if (!publication.request || publication.rootPublishedAtMs || publication.completedAtMs) {
          return false;
        }
        return entries.every((entry) => !entry.step?.xPostId && !entry.step?.publishedAtMs);
      }

      function publicationEditPanel(publication, entries, editable) {
        const request = publication.request || {};
        const form = document.createElement("form");
        form.className = "publication-edit publication-edit-form publication-editor";
        form.dataset.role = "publication-editor";
        form.dataset.publicationId = publication.id || "";
        const details = document.createElement("details");
        details.className = "publication-edit-accordion";
        details.dataset.role = "publication-edit-accordion";
        details.open = false;
        const summary = document.createElement("summary");
        summary.tabIndex = 0;
        const summaryTitle = document.createElement("span");
        summaryTitle.className = "publication-edit-summary-title";
        summaryTitle.textContent = "編集項目";
        const summaryMeta = document.createElement("span");
        summaryMeta.className = "publication-edit-summary-meta";
        summaryMeta.textContent = editSummaryMeta(publication, entries);
        summary.append(summaryTitle, summaryMeta);
        const body = document.createElement("div");
        body.className = "publication-edit-body";

        const grid = document.createElement("div");
        grid.className = "publication-edit-grid";
        const dateField = editableInputField({
          labelText: "投稿日時",
          name: "scheduledAt",
          type: "datetime-local",
          value: datetimeLocalValue(publication.scheduledAtMs),
          required: true,
          configure: (input) => {
            input.step = "60";
          }
        });

        const primary = entries.find((entry) => entry.step?.stepType === "MAIN") || entries[0];
        const contentField = editableTextareaField({
          labelText: "Step 1 投稿内容",
          name: "contentText",
          value: request.content?.text || primary?.step?.text || "",
          required: true,
          badge: primary ? badgeInline(entryStatus(primary)) : null
        });
        grid.append(dateField, contentField);
        body.append(grid);

        const poll = request.content?.poll;
        if (Array.isArray(poll?.options)) {
          body.append(pollOptionsField(poll));
        }

        const followUps = Array.isArray(request.followUps) ? request.followUps : [];
        followUps.forEach((followUp, index) => {
          const entry = entries.find((candidate) => candidate.step?.stepType === "FOLLOW_UP" && candidate.sequence === index + 2);
          const field = editableTextareaField({
            labelText: "返信 Step " + (index + 2),
            name: "followUpText",
            value: followUp.content?.text || entry?.step?.text || "",
            required: true,
            className: "follow-up-text",
            dataset: { followUpIndex: String(index) },
            badge: entry ? badgeInline(entryStatus(entry)) : null
          });
          body.append(field);
        });

        const actions = document.createElement("div");
        actions.className = "publication-edit-actions";
        if (editable) {
          const cancelButton = document.createElement("button");
          cancelButton.className = "button small";
          cancelButton.type = "button";
          cancelButton.dataset.role = "cancel";
          cancelButton.textContent = "キャンセル";
          cancelButton.addEventListener("click", () => {
            closePublicationEditor(form);
          });

          const saveButton = document.createElement("button");
          saveButton.className = "button primary small";
          saveButton.type = "submit";
          saveButton.dataset.role = "save";
          saveButton.textContent = "保存";
          actions.append(cancelButton, saveButton);
          form.addEventListener("submit", (event) => {
            event.preventDefault();
            void editPublication(publication, form, saveButton);
          });
        } else {
          const note = document.createElement("div");
          note.className = "publication-edit-note";
          note.textContent = "この投稿は編集できません";
          actions.append(note);
        }
        body.append(actions);
        details.append(summary, body);
        form.append(details);
        setPublicationFormEditing(form, editable);
        return form;
      }

      function editSummaryMeta(publication, entries) {
        const parts = ["投稿日時", "本文"];
        const request = publication.request || {};
        if (Array.isArray(request.content?.poll?.options)) {
          parts.push("投票");
        }
        if (Array.isArray(request.followUps) && request.followUps.length > 0) {
          parts.push("返信 " + request.followUps.length + "件");
        } else if (entries.length > 1) {
          parts.push("Step " + entries.length + "件");
        }
        return parts.join("・");
      }

      function editableInputField({ labelText, name, type, value, required = false, configure = null }) {
        const field = document.createElement("div");
        field.className = "publication-edit-field";
        const label = document.createElement("label");
        label.textContent = labelText;
        const input = document.createElement("input");
        input.name = name;
        input.type = type;
        input.required = required;
        input.value = value || "";
        input.defaultValue = value || "";
        input.dataset.editable = "true";
        if (configure) {
          configure(input);
        }
        label.append(input);
        field.append(label);
        return field;
      }

      function editableTextareaField({ labelText, name, value, required = false, className = "", dataset = {}, badge = null }) {
        const field = document.createElement("div");
        field.className = "publication-edit-field";
        const label = document.createElement("label");
        const labelLine = document.createElement("span");
        labelLine.className = "primary-line";
        const labelTextSpan = document.createElement("span");
        labelTextSpan.textContent = labelText;
        labelLine.append(labelTextSpan);
        if (badge) {
          labelLine.append(badge);
        }
        const textarea = document.createElement("textarea");
        textarea.name = name;
        textarea.required = required;
        textarea.className = className;
        textarea.value = value || "";
        textarea.defaultValue = value || "";
        textarea.dataset.editable = "true";
        for (const [key, dataValue] of Object.entries(dataset)) {
          textarea.dataset[key] = dataValue;
        }
        label.append(labelLine, textarea);
        field.append(label);
        return field;
      }

      function pollOptionsField(poll) {
        const field = document.createElement("div");
        field.className = "publication-edit-subgrid";
        const label = document.createElement("div");
        label.className = "publication-edit-label";
        label.textContent = "投票選択肢";
        const options = document.createElement("div");
        options.className = "poll-options-grid";
        poll.options.forEach((option, index) => {
          options.append(
            editableInputField({
              labelText: "選択肢 " + (index + 1),
              name: "pollOption",
              type: "text",
              value: option,
              required: true,
              configure: (input) => {
                input.dataset.pollOptionIndex = String(index);
              }
            })
          );
        });
        field.append(label, options);
        if (poll.durationMinutes) {
          const note = document.createElement("div");
          note.className = "publication-edit-note";
          note.textContent = "投票期間 " + formatDurationMinutes(poll.durationMinutes);
          field.append(note);
        }
        return field;
      }

      function setPublicationFormEditing(form, editing) {
        form.classList.toggle("is-editing", editing);
        form.dataset.editing = String(editing);
        for (const control of form.querySelectorAll("[data-editable]")) {
          control.readOnly = !editing;
          control.tabIndex = editing ? 0 : -1;
          control.setAttribute("aria-readonly", String(!editing));
        }
        const editButton = form.querySelector("[data-role='edit']");
        const saveButton = form.querySelector("[data-role='save']");
        const cancelButton = form.querySelector("[data-role='cancel']");
        if (editButton) {
          editButton.hidden = editing;
        }
        if (saveButton) {
          saveButton.hidden = !editing;
          saveButton.disabled = !editing;
        }
        if (cancelButton) {
          cancelButton.hidden = !editing;
        }
      }

      function publicationPatchBody(publication, form) {
        const request = cloneRequest(publication.request || {});
        delete request.scheduledAtMs;
        request.scheduledAt = localDateTimeWithOffset(form.elements.scheduledAt.value);
        request.content = {
          ...(request.content || {}),
          text: form.elements.contentText.value
        };
        const pollOptions = pollOptionInputsFor(form).map((input) => input.value.trim());
        if (request.content.poll && pollOptions.length > 0) {
          request.content.poll = {
            ...request.content.poll,
            options: pollOptions
          };
        }
        if (Array.isArray(request.followUps)) {
          for (const textarea of form.querySelectorAll("textarea[data-follow-up-index]")) {
            const index = Number(textarea.dataset.followUpIndex);
            if (Number.isInteger(index) && request.followUps[index]) {
              request.followUps[index] = {
                ...request.followUps[index],
                content: {
                  ...(request.followUps[index].content || {}),
                  text: textarea.value
                }
              };
            }
          }
        }
        return request;
      }

      function pollOptionInputsFor(form) {
        return Array.from(form.querySelectorAll("input[data-poll-option-index]")).sort(
          (left, right) => Number(left.dataset.pollOptionIndex) - Number(right.dataset.pollOptionIndex)
        );
      }

      function cloneRequest(value) {
        return JSON.parse(JSON.stringify(value || {}));
      }

      function stepCategory(entry) {
        if (entry.publication?.status === "CANCELLED") {
          return isFutureCancelledPublication(entry.publication) ? "cancelled" : "hidden";
        }
        const status = entryStatus(entry);
        if (!isDismissedProblem(entry.publication) && isProblemEntry(entry)) {
          return "problem";
        }
        if (pendingApprovalStatuses.has(status)) {
          return "pendingApproval";
        }
        if (readyBeforeStatuses.has(status)) {
          return "ready";
        }
        if (postedStatuses.has(status)) {
          return "posted";
        }
        return "all";
      }

      function isFutureCancelledPublication(publication) {
        const scheduledAtMs = Number(publication?.scheduledAtMs);
        return publication?.status === "CANCELLED" && Number.isFinite(scheduledAtMs) && scheduledAtMs > Date.now();
      }

      function isProblemEntry(entry) {
        const status = entryStatus(entry);
        return isApprovalExpired(entry.publication) || problemStatuses.has(status);
      }

      function stepEntriesFor(item) {
        const publication = item.publication || {};
        const activePlan = findActivePlan(item);
        const steps = Array.isArray(activePlan?.steps) ? activePlan.steps : [];
        if (steps.length === 0) {
          return [{ item, publication, activePlan, step: null, sequence: 1, total: 1 }];
        }
        return steps.map((step, index) => ({
          item,
          publication,
          activePlan,
          step,
          sequence: step.sequence || index + 1,
          total: steps.length
        }));
      }

      function entryStatus(entry) {
        const publicationStatus = entry.publication?.status || "UNKNOWN";
        const stepStatus = entry.step?.status;
        if (stepStatus === "PUBLISHED" || stepStatus === "FAILED" || stepStatus === "DELIVERY_UNKNOWN" || stepStatus === "RETRY_SCHEDULED") {
          return stepStatus;
        }
        return publicationStatus;
      }

      function findActivePlan(item) {
        const publication = item.publication || {};
        const plans = Array.isArray(item.plans) ? item.plans : [];
        return plans.find((plan) => plan.id === publication.activePlanId) || plans.find((plan) => plan.isActive) || plans[0];
      }

      function firstStepPoll(plan) {
        return plan?.steps?.find((step) => step.poll)?.poll || null;
      }

      function stepDateFor(entry) {
        const publication = entry.publication || {};
        const step = entry.step;
        if (step?.publishedAtMs) {
          return formatDate(step.publishedAtMs);
        }
        if (!step || step.stepType === "MAIN") {
          return formatDate(publication.completedAtMs || publication.rootPublishedAtMs || publication.scheduledAtMs);
        }
        if (step.resolvedDueAtMs) {
          return formatDate(step.resolvedDueAtMs);
        }
        const estimated = estimatedStepDueAtMs(entry);
        return estimated === null ? triggerLabel(step) : formatDate(estimated);
      }

      function estimatedStepDueAtMs(entry) {
        const publication = entry.publication || {};
        const step = entry.step;
        if (!step) {
          return null;
        }
        const root = entry.activePlan?.steps?.find((candidate) => candidate.relation === "ROOT");
        const baseMs = publication.rootPublishedAtMs || publication.scheduledAtMs;
        if (!baseMs) {
          return null;
        }
        const pollMinutes = step.triggerType === "AFTER_POLL_CLOSE" ? root?.poll?.durationMinutes || 0 : 0;
        if (step.triggerType === "AFTER_PARENT_PUBLISHED" || step.triggerType === "AFTER_POLL_CLOSE") {
          return baseMs + (pollMinutes + (step.triggerOffsetMinutes || 0)) * 60 * 1000;
        }
        return baseMs;
      }

      function publicationStepSummary(entries) {
        const mainCount = entries.filter((entry) => entry.step?.stepType !== "FOLLOW_UP").length;
        const followCount = entries.filter((entry) => entry.step?.stepType === "FOLLOW_UP").length;
        return ["本投稿 " + mainCount, followCount > 0 ? "返信 " + followCount : "", "全Step " + entries.length].filter(Boolean).join(" / ");
      }

      function approvalControlFor(publication) {
        const approvalState = approvalStateFor(publication);
        if (!approvalState) {
          return null;
        }
        const control = document.createElement("div");
        control.className = "card-approval-control";
        if (approvalState.expired) {
          const badge = document.createElement("span");
          badge.className = "badge problem";
          badge.textContent = "期限切れ";
          control.append(badge);
        }
        const note = document.createElement("span");
        note.className = "approval-note";
        note.textContent = approvalState.expired
          ? "承認期限 " + formatDate(approvalState.deadlineMs) + " を過ぎています"
          : "承認期限 " + formatDate(approvalState.deadlineMs);
        control.append(note);
        if (!approvalState.expired) {
          const button = document.createElement("button");
          button.className = "button primary small";
          button.type = "button";
          button.textContent = "承認";
          button.disabled = state.bulkApproving;
          button.addEventListener("click", () => void approvePublication(publication, button));
          control.append(button);
        }
        return control;
      }

      function approvalStateFor(publication) {
        if (!publication || publication.status !== "PENDING_APPROVAL") {
          return null;
        }
        const scheduledAtMs = Number(publication.scheduledAtMs);
        const deadlineMs = Number.isFinite(scheduledAtMs) ? scheduledAtMs + approvalGraceSeconds * 1000 : null;
        return {
          expired: deadlineMs !== null && deadlineMs < Date.now(),
          deadlineMs
        };
      }

      function isApprovalExpired(publication) {
        return approvalStateFor(publication)?.expired === true;
      }

      function stepLabel(entry) {
        if (!entry.step) {
          return "Publication";
        }
        const kind = entry.step.stepType === "FOLLOW_UP" ? "返信" : "本投稿";
        return ["Step " + entry.sequence + "/" + entry.total, kind, triggerLabel(entry.step)].filter(Boolean).join(" / ");
      }

      function shortId(value) {
        const text = String(value || "—");
        return text.length > 22 ? text.slice(0, 10) + "..." + text.slice(-6) : text;
      }

      function appendOptions(select, options, selectedValue) {
        select.replaceChildren();
        for (const option of options) {
          const element = document.createElement("option");
          element.value = String(option.value);
          element.textContent = option.label;
          element.selected = String(option.value) === String(selectedValue);
          select.append(element);
        }
      }

      function appendAccountOptions(select, permission) {
        select.replaceChildren();
        const seen = new Set();
        const selectedAccount = permission?.xAccount;
        if (selectedAccount?.id) {
          appendAccountOption(select, selectedAccount.id, accountDisplayName(selectedAccount), seen);
        }
        for (const account of state.accounts) {
          appendAccountOption(select, account.id, accountDisplayName(account), seen);
        }
      }

      function appendAccountOption(select, value, labelText, seen) {
        if (!value || seen.has(value)) {
          return;
        }
        seen.add(value);
        const option = document.createElement("option");
        option.value = value;
        option.textContent = labelText;
        select.append(option);
      }

      function accountDisplayName(account) {
        return [account.name, account.xUsername || account.x_username ? "@" + (account.xUsername || account.x_username) : "", account.id]
          .filter(Boolean)
          .join(" / ");
      }

      function accountForPublication(publication) {
        const xAccountId = publication?.xAccountId;
        return state.accounts.find((account) => account.id === xAccountId) || null;
      }

      function accountNameForPublication(publication) {
        const account = accountForPublication(publication);
        return account?.name || publication?.request?.accountName || shortId(publication?.xAccountId || "X Account");
      }

      function accountHandleForPublication(publication) {
        const account = accountForPublication(publication);
        const username = account?.xUsername || account?.x_username;
        return username ? "@" + username : "@" + shortId(publication?.xAccountId || "account");
      }

      function accountAvatarText(publication) {
        const name = accountNameForPublication(publication).trim();
        return (name[0] || "X").toUpperCase();
      }

      function idempotencyKey(prefix) {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
          return prefix + "-" + crypto.randomUUID();
        }
        return prefix + "-" + Date.now() + "-" + Math.random().toString(16).slice(2);
      }

      function compactMeta(labelText, value, extraClass = "", titleValue = null) {
        const item = document.createElement("span");
        item.className = "compact-meta";
        const label = document.createElement("span");
        label.className = "compact-meta-label";
        label.textContent = labelText;
        const text = document.createElement("span");
        text.className = ["compact-meta-value", extraClass].filter(Boolean).join(" ");
        text.textContent = value === undefined || value === null || value === "" ? "—" : String(value);
        if (titleValue !== null && titleValue !== undefined && titleValue !== "") {
          text.title = String(titleValue);
        }
        item.append(label, text);
        return item;
      }

      function memoCompactMeta(memo) {
        if (!memo || typeof memo !== "object" || Array.isArray(memo)) {
          return [];
        }
        return Object.entries(memo)
          .filter((entry) => entry[1] !== null && entry[1] !== undefined && entry[1] !== "")
          .slice(0, 4)
          .map(([key, value]) => compactMeta(key, value));
      }

      function pollCompactMeta(poll) {
        if (!Array.isArray(poll?.options)) {
          return [];
        }
        const items = [compactMeta("投票", poll.options.join(" / "))];
        if (poll.durationMinutes) {
          items.push(compactMeta("期間", formatDurationMinutes(poll.durationMinutes)));
        }
        return items;
      }

      function formatDurationMinutes(value) {
        const minutes = Number(value);
        if (!Number.isFinite(minutes) || minutes <= 0) {
          return String(value) + "分";
        }
        if (minutes % 1440 === 0) {
          return String(minutes / 1440) + "日";
        }
        if (minutes % 60 === 0) {
          return String(minutes / 60) + "時間";
        }
        return String(minutes) + "分";
      }

      function badgeInline(status) {
        const badge = document.createElement("span");
        badge.className = "badge " + badgeType(status);
        badge.textContent = status;
        return badge;
      }

      function triggerLabel(step) {
        if (!step || step.triggerType === "AT_PUBLICATION_TIME") {
          return "予約時刻";
        }
        if (step.triggerType === "AFTER_PARENT_PUBLISHED") {
          return "親投稿+" + (step.triggerOffsetMinutes || 0) + "分";
        }
        if (step.triggerType === "AFTER_POLL_CLOSE") {
          return "投票終了+" + (step.triggerOffsetMinutes || 0) + "分";
        }
        return step.triggerType;
      }

      function cellWithBadge(status) {
        const td = document.createElement("td");
        const badge = document.createElement("span");
        badge.className = "badge " + badgeType(status);
        badge.textContent = status;
        td.append(badge);
        return td;
      }

      function textCell(value, className) {
        const td = document.createElement("td");
        if (className) {
          td.className = className;
        }
        td.textContent = value === undefined || value === null || value === "" ? "—" : String(value);
        return td;
      }

      function badgeType(status) {
        if (status === "ACTIVE") return "posted";
        if (status === "DISABLED") return "disabled";
        if (status === "AUTH_ERROR") return "attention";
        if (status === "CANCELLED") return "cancelled";
        if (beforeStatuses.has(status)) return "before";
        if (postedStatuses.has(status)) return "posted";
        if (problemStatuses.has(status)) return "problem";
        return "";
      }

      function formatDate(value) {
        if (!value) return "—";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "—";
        return new Intl.DateTimeFormat("ja-JP", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit"
        }).format(date);
      }

      function datetimeLocalValue(value) {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        return [
          date.getFullYear(),
          "-",
          pad2(date.getMonth() + 1),
          "-",
          pad2(date.getDate()),
          "T",
          pad2(date.getHours()),
          ":",
          pad2(date.getMinutes())
        ].join("");
      }

      function localDateTimeWithOffset(value) {
        if (!value) {
          throw new Error("投稿日時を入力してください");
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
          throw new Error("投稿日時を確認してください");
        }
        const offsetMinutes = -date.getTimezoneOffset();
        const sign = offsetMinutes >= 0 ? "+" : "-";
        const absoluteOffset = Math.abs(offsetMinutes);
        const offset = sign + pad2(Math.floor(absoluteOffset / 60)) + ":" + pad2(absoluteOffset % 60);
        const local = value.length === 16 ? value + ":00" : value;
        return local + offset;
      }

      function pad2(value) {
        return String(value).padStart(2, "0");
      }

      function setStatus(message, isError = false) {
        statusLine.textContent = message;
        statusLine.classList.toggle("error", isError);
      }

      render();
      renderAccounts();
      renderClients();
    </script>
  </body>
</html>`;

export function adminRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get("/admin", (c) => (isBasicAuthAllowed(c) ? adminResponse(c) : basicAuthResponse()));
  app.get("/admin/", (c) => (isBasicAuthAllowed(c) ? adminResponse(c) : basicAuthResponse()));

  return app;
}

function isBasicAuthAllowed(c: Context<AppBindings>): boolean {
  const expectedUsername = c.env.ADMIN_BASIC_USERNAME;
  const expectedPassword = c.env.ADMIN_BASIC_PASSWORD;
  if (expectedUsername === undefined || expectedPassword === undefined) {
    return false;
  }
  const authorization = c.req.header("Authorization");
  if (authorization === undefined || !authorization.startsWith("Basic ")) {
    return false;
  }
  const decoded = decodeBasicCredentials(authorization.slice("Basic ".length));
  if (decoded === null) {
    return false;
  }
  return constantTimeEqual(decoded.username, expectedUsername) && constantTimeEqual(decoded.password, expectedPassword);
}

function decodeBasicCredentials(encoded: string): { username: string; password: string } | null {
  try {
    const decoded = atob(encoded);
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex < 0) {
      return null;
    }
    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1)
    };
  } catch {
    return null;
  }
}

function basicAuthResponse(): Response {
  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
      "WWW-Authenticate": 'Basic realm="x-posting-kun", charset="UTF-8"'
    }
  });
}

function adminResponse(c: Context<AppBindings>): Response {
  const parsedGraceSeconds = Number.parseInt(c.env.SCHEDULE_GRACE_SECONDS ?? "", 10);
  const approvalGraceSeconds = Number.isFinite(parsedGraceSeconds) && parsedGraceSeconds > 0 ? parsedGraceSeconds : 120;
  return new Response(adminHtml.replace("__APPROVAL_GRACE_SECONDS__", String(approvalGraceSeconds)), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
