import { Hono } from "hono";
import type { Context } from "hono";
import { constantTimeEqual } from "../../shared/crypto";
import type { AppBindings } from "../context";

const adminHtml = String.raw`<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>X Posting Admin</title>
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
      input {
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

      .stats {
        display: grid;
        grid-template-columns: repeat(4, minmax(110px, 1fr));
        gap: 10px;
        margin-bottom: 16px;
      }

      .stat {
        min-height: 78px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--surface);
        padding: 12px;
      }

      .stat span {
        display: block;
        color: var(--muted);
        font-size: 13px;
      }

      .stat strong {
        display: block;
        margin-top: 6px;
        font-size: 28px;
        line-height: 1;
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
        border-left-width: 4px;
        border-radius: 7px;
        background: var(--surface);
        overflow: hidden;
      }

      .publication-card.before {
        border-left-color: var(--accent);
      }

      .publication-card.posted {
        border-left-color: var(--ok);
      }

      .publication-card.attention {
        border-left-color: var(--warn);
      }

      .publication-card-head {
        display: grid;
        gap: 5px;
        align-items: center;
        padding: 8px 11px;
        border-bottom: 1px solid var(--line);
        background: #fbfcfa;
      }

      .publication-card-body {
        display: grid;
        gap: 7px;
        padding: 8px 11px 10px;
      }

      .approval-banner {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
        border: 1px solid #b7d7d2;
        border-radius: 6px;
        background: #eef8f6;
        padding: 7px 8px;
      }

      .approval-banner.expired {
        border-color: #f0d19a;
        background: #fff8e8;
      }

      .approval-copy {
        display: flex;
        min-width: 0;
        flex-wrap: wrap;
        gap: 5px 8px;
        align-items: center;
      }

      .approval-note {
        min-width: 0;
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
        line-height: 1.35;
      }

      .step-block {
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #ffffff;
        overflow: hidden;
      }

      .step-block.main-step {
        border-color: #c9d7d4;
      }

      .step-block.child-step {
        border-color: #dce4db;
        background: #fbfcfa;
      }

      .step-block-head {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        padding: 5px 8px;
        border-bottom: 1px solid var(--line);
        background: #f3f7f3;
      }

      .step-block-body {
        padding: 7px 8px 8px;
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
        gap: 8px;
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

      .badge.attention {
        background: #fff2d6;
        color: var(--warn);
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

      .step-block-head .primary-line {
        margin-bottom: 0;
      }

      .mini-label {
        display: inline-flex;
        align-items: center;
        min-height: 20px;
        border-radius: 5px;
        padding: 1px 6px;
        background: var(--surface-soft);
        color: var(--accent-strong);
        font-size: 11px;
        font-weight: 700;
        white-space: nowrap;
      }

      .text-preview {
        display: -webkit-box;
        overflow: hidden;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        white-space: pre-wrap;
        font-size: 14px;
        line-height: 1.38;
      }

      .full-text {
        margin-top: 5px;
        white-space: pre-wrap;
        font-size: 14px;
        line-height: 1.45;
      }

      details.compact-details {
        margin-top: 2px;
      }

      details.compact-details > summary {
        cursor: pointer;
        color: var(--accent-strong);
        font-size: 12px;
        font-weight: 700;
      }

      .step-list {
        display: grid;
        gap: 6px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .step-children {
        display: grid;
        gap: 5px;
      }

      .step-children-label {
        color: var(--muted);
        font-size: 12px;
        font-weight: 800;
        line-height: 1.35;
      }

      .child-step {
        margin: 0;
      }

      .full-step-text {
        white-space: pre-wrap;
        font-size: 14px;
        line-height: 1.45;
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

        .stats {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .client-edit-row,
        .permission-edit-row {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <header class="topbar">
      <h1>X Posting Admin</h1>
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
      <section class="panel" aria-label="Xアカウント">
        <div class="panel-head">
          <h2>Xアカウント</h2>
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
      </section>
      <section class="panel" aria-label="APIクライアント">
        <div class="panel-head">
          <h2>APIクライアント</h2>
          <button class="button" id="refreshClients" type="button">再読込</button>
        </div>
        <ul class="client-list" id="clientRows">
          <li class="empty-state">API keyを入力してください</li>
        </ul>
      </section>
      <section class="stats" aria-label="件数">
        <div class="stat"><span>投稿前Step</span><strong id="beforeCount">0</strong></div>
        <div class="stat"><span>投稿済Step</span><strong id="postedCount">0</strong></div>
        <div class="stat"><span>要確認Step</span><strong id="attentionCount">0</strong></div>
        <div class="stat"><span>全Step</span><strong id="allCount">0</strong></div>
      </section>
      <nav class="tabs" aria-label="絞り込み">
        <button class="tab" data-filter="before" type="button" aria-selected="true">投稿前</button>
        <button class="tab" data-filter="posted" type="button" aria-selected="false">投稿済み</button>
        <button class="tab" data-filter="attention" type="button" aria-selected="false">要確認</button>
        <button class="tab" data-filter="all" type="button" aria-selected="false">全件</button>
      </nav>
      <section class="publication-section" aria-label="投稿一覧">
        <ul class="publication-list" id="rows">
          <li class="empty-state">API keyを入力してください</li>
        </ul>
      </section>
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
      const refreshButton = document.getElementById("refresh");
      const refreshAccountsButton = document.getElementById("refreshAccounts");
      const refreshClientsButton = document.getElementById("refreshClients");
      const filters = document.querySelectorAll("[data-filter]");
      const counts = {
        before: document.getElementById("beforeCount"),
        posted: document.getElementById("postedCount"),
        attention: document.getElementById("attentionCount"),
        all: document.getElementById("allCount")
      };
      const approvalGraceSeconds = Number.parseInt("__APPROVAL_GRACE_SECONDS__", 10) || 120;

      const beforeStatuses = new Set(["DRAFT", "PENDING_APPROVAL", "SCHEDULED", "QUEUED", "PUBLISHING", "AWAITING_FOLLOW_UP", "RETRY_SCHEDULED"]);
      const postedStatuses = new Set(["PUBLISHED", "PARTIALLY_PUBLISHED"]);
      const attentionStatuses = new Set(["FAILED", "DELIVERY_UNKNOWN", "BLOCKED_POLICY", "REJECTED", "CANCELLED"]);
      const defaultScopes = ["publication:preview", "publication:create", "publication:submit", "publication:read", "publication:update", "publication:cancel", "publication:approve", "publication:reject", "publication:retry", "publication:reconcile", "media:create", "account:read", "account:manage"];
      const aiForbiddenScopes = new Set(["publication:approve", "publication:reject", "publication:reconcile", "publication:retry", "account:manage"]);
      const permissionLevels = [
        { value: 0, label: "0 DENY" },
        { value: 1, label: "1 DRAFT_ONLY" },
        { value: 2, label: "2 HUMAN_APPROVAL_REQUIRED" },
        { value: 3, label: "3 POLICY_BASED_AUTO" }
      ];
      const state = {
        apiKey: localStorage.getItem("xpo_admin_api_key") || "",
        filter: "before",
        publications: [],
        accounts: [],
        apiClients: [],
        availableScopes: defaultScopes
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
        state.publications = [];
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

      filters.forEach((button) => {
        button.addEventListener("click", () => {
          state.filter = button.dataset.filter;
          filters.forEach((candidate) => candidate.setAttribute("aria-selected", String(candidate === button)));
          render();
        });
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

      async function loadAll(successMessage = null) {
        if (!state.apiKey) {
          setStatus("未接続", true);
          renderAccounts();
          render();
          return;
        }
        refreshButton.disabled = true;
        refreshAccountsButton.disabled = true;
        refreshClientsButton.disabled = true;
        setStatus("読み込み中");
        try {
          await Promise.all([loadAccounts(false), loadApiClients(false), loadPublications(false)]);
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

      async function loadPublications(updateStatus = true) {
        if (!state.apiKey) {
          setStatus("未接続", true);
          render();
          return;
        }
        refreshButton.disabled = true;
        if (updateStatus) {
          setStatus("投稿を読み込み中");
        }
        try {
          const response = await fetch("/v1/publications?limit=100", {
            headers: {
              Authorization: "Bearer " + state.apiKey
            }
          });
          if (!response.ok) {
            const text = await response.text();
            throw new Error(text || response.statusText);
          }
          const data = await response.json();
          state.publications = Array.isArray(data.publications) ? data.publications : [];
          render();
          if (updateStatus) {
            setStatus("投稿を更新しました");
          }
        } catch (error) {
          state.publications = [];
          render();
          if (updateStatus) {
            setStatus(error instanceof Error ? error.message : "投稿の読み込みに失敗しました", true);
            return;
          }
          throw error;
        } finally {
          refreshButton.disabled = false;
        }
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
        if (!publication?.id) {
          setStatus("Publication IDを取得できませんでした", true);
          return;
        }
        if (!publication.revision || !publication.contentHash) {
          setStatus("承認に必要なrevision/contentHashを取得できませんでした", true);
          return;
        }
        localStorage.setItem("xpo_admin_api_key", state.apiKey);
        if (button) {
          button.disabled = true;
        }
        setStatus("承認中");
        try {
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
              comment: "Approved from admin UI"
            })
          });
          if (!response.ok) {
            const text = await response.text();
            throw new Error(text || response.statusText);
          }
          await loadPublications(false);
          setStatus("承認しました");
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "承認に失敗しました", true);
        } finally {
          if (button) {
            button.disabled = false;
          }
        }
      }

      function render() {
        const grouped = groupPublicationsForRows(state.publications);
        const stepCounts = countPublicationSteps(state.publications);
        counts.before.textContent = String(stepCounts.before);
        counts.posted.textContent = String(stepCounts.posted);
        counts.attention.textContent = String(stepCounts.attention);
        counts.all.textContent = String(stepCounts.all);
        const visible = state.filter === "all" ? grouped.all : grouped[state.filter];
        rows.replaceChildren();
        if (!visible || visible.length === 0) {
          const li = document.createElement("li");
          li.className = "empty-state";
          li.textContent = "表示する投稿はありません";
          rows.append(li);
          return;
        }
        for (const item of visible) {
          rows.append(publicationCardFor(item));
        }
      }

      function renderAccounts() {
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

      function renderClients() {
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
        const card = document.createElement("li");
        card.className = ["publication-card", isApprovalExpired(publication) ? "attention" : badgeType(primaryStatus)].filter(Boolean).join(" ");
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
        titleRow.append(badgeInline(primaryStatus), date, summary);
        const headMeta = document.createElement("div");
        headMeta.className = "card-meta-row";
        headMeta.append(
          compactMeta("Account", shortId(publication.xAccountId || "—"), "mono", publication.xAccountId || "—")
        );
        headMeta.append(...memoCompactMeta(publication.request?.memo));
        for (const xPostId of entries.map((entry) => entry.step?.xPostId).filter(Boolean)) {
          headMeta.append(compactMeta("X", shortId(xPostId), "mono", xPostId));
        }
        headMeta.append(...pollCompactMeta(primary.step?.poll || firstStepPoll(activePlan)));
        head.append(titleRow, headMeta);

        const body = document.createElement("div");
        body.className = "publication-card-body";
        const approvalBanner = approvalBannerFor(publication);
        if (approvalBanner) {
          body.append(approvalBanner);
        }
        body.append(stepPreviewBlock(primary, stepLabel(primary), false, true));

        const children = entries.filter((entry) => entry !== primary);
        if (children.length > 0) {
          body.append(childStepsBlock(children));
        }

        card.append(head, body);
        return card;
      }

      function markAccount(xAccountId) {
        const target = Array.from(accountRows.querySelectorAll("tr")).find((row) => row.dataset.accountId === xAccountId);
        if (target) {
          target.scrollIntoView({ block: "nearest" });
        }
      }

      function groupPublicationsForRows(items) {
        return {
          all: items,
          before: items.filter((item) => stepEntriesFor(item).some((entry) => beforeStatuses.has(entryStatus(entry)))),
          posted: items.filter((item) => stepEntriesFor(item).some((entry) => postedStatuses.has(entryStatus(entry)))),
          attention: items.filter((item) => isApprovalExpired(item.publication) || stepEntriesFor(item).some((entry) => attentionStatuses.has(entryStatus(entry))))
        };
      }

      function countPublicationSteps(items) {
        const all = items.flatMap(stepEntriesFor);
        return {
          all: all.length,
          before: all.filter((entry) => beforeStatuses.has(entryStatus(entry))).length,
          posted: all.filter((entry) => postedStatuses.has(entryStatus(entry))).length,
          attention: all.filter((entry) => attentionStatuses.has(entryStatus(entry)) || isApprovalExpired(entry.publication)).length
        };
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

      function approvalBannerFor(publication) {
        const approvalState = approvalStateFor(publication);
        if (!approvalState) {
          return null;
        }
        const banner = document.createElement("div");
        banner.className = "approval-banner" + (approvalState.expired ? " expired" : "");
        const copy = document.createElement("div");
        copy.className = "approval-copy";
        const badge = document.createElement("span");
        badge.className = "badge " + (approvalState.expired ? "attention" : "before");
        badge.textContent = approvalState.expired ? "期限切れ" : "承認待ち";
        const note = document.createElement("span");
        note.className = "approval-note";
        note.textContent = approvalState.expired
          ? "承認期限 " + formatDate(approvalState.deadlineMs) + " を過ぎています"
          : "承認期限 " + formatDate(approvalState.deadlineMs);
        copy.append(badge, note);
        banner.append(copy);
        if (!approvalState.expired) {
          const button = document.createElement("button");
          button.className = "button primary small";
          button.type = "button";
          button.textContent = "承認";
          button.addEventListener("click", () => void approvePublication(publication, button));
          banner.append(button);
        }
        return banner;
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

      function idempotencyKey(prefix) {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
          return prefix + "-" + crypto.randomUUID();
        }
        return prefix + "-" + Date.now() + "-" + Math.random().toString(16).slice(2);
      }

      function childStepsBlock(children) {
        const container = document.createElement("div");
        container.className = "step-children";
        const label = document.createElement("div");
        label.className = "step-children-label";
        label.textContent = "Step2以降 " + children.length + "件";
        const list = document.createElement("ul");
        list.className = "step-list";
        for (const child of children) {
          const item = document.createElement("li");
          item.className = "child-step";
          item.append(stepFullBlock(child, stepLabel(child)));
          list.append(item);
        }
        container.append(label, list);
        return container;
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

      function stepPreviewBlock(entry, labelText, showStatus = true, isMain = false) {
        const block = document.createElement("div");
        block.className = "step-block" + (isMain ? " main-step" : "");
        const head = document.createElement("div");
        head.className = "step-block-head";
        const body = document.createElement("div");
        body.className = "step-block-body";
        const container = document.createElement("div");
        const line = document.createElement("div");
        line.className = "primary-line";
        const label = document.createElement("span");
        label.className = "mini-label";
        label.textContent = labelText;
        line.append(label);
        if (showStatus) {
          line.append(badgeInline(entryStatus(entry)));
        }
        head.append(line);
        body.append(compactText(entry.step?.text || ""));
        block.append(head, body);
        container.append(block);
        return container;
      }

      function stepFullBlock(entry, labelText) {
        const block = document.createElement("div");
        block.className = "step-block child-step";
        const head = document.createElement("div");
        head.className = "step-block-head";
        const line = document.createElement("div");
        line.className = "primary-line";
        const label = document.createElement("span");
        label.className = "mini-label";
        label.textContent = labelText;
        line.append(label, badgeInline(entryStatus(entry)));
        head.append(line);
        const body = document.createElement("div");
        body.className = "step-block-body";
        const text = document.createElement("div");
        text.className = "full-step-text";
        text.textContent = entry.step?.text || "—";
        body.append(text);
        block.append(head, body);
        return block;
      }

      function compactText(value) {
        const container = document.createElement("div");
        const parts = splitPreviewAndContinuation(value || "—");
        const preview = document.createElement("div");
        preview.className = "text-preview";
        preview.textContent = parts.preview;
        container.append(preview);
        if (parts.continuation) {
          const details = document.createElement("details");
          details.className = "compact-details";
          const summary = document.createElement("summary");
          summary.textContent = "続き";
          const full = document.createElement("div");
          full.className = "full-text";
          full.textContent = parts.continuation;
          details.append(summary, full);
          container.append(details);
        }
        return container;
      }

      function splitPreviewAndContinuation(value) {
        const text = value || "—";
        const maxPreviewLines = 2;
        const maxPreviewChars = 110;
        const lines = text.split("\n");
        let cutIndex = text.length;
        if (lines.length > maxPreviewLines) {
          cutIndex = lines.slice(0, maxPreviewLines).join("\n").length;
        }
        if (text.length > maxPreviewChars) {
          cutIndex = Math.min(cutIndex, previewCutIndex(text, maxPreviewChars));
        }
        if (cutIndex >= text.length) {
          return { preview: text, continuation: "" };
        }
        const preview = text.slice(0, cutIndex).replace(/\s+$/, "");
        const continuation = text.slice(cutIndex).replace(/^\s+/, "");
        return {
          preview: preview + "...",
          continuation
        };
      }

      function previewCutIndex(text, maxLength) {
        const hardCut = Math.min(text.length, maxLength);
        const lastBreak = Math.max(
          text.lastIndexOf("\n", hardCut),
          text.lastIndexOf("。", hardCut),
          text.lastIndexOf("、", hardCut),
          text.lastIndexOf(" ", hardCut)
        );
        return lastBreak > 48 ? lastBreak + 1 : hardCut;
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
        if (beforeStatuses.has(status)) return "before";
        if (postedStatuses.has(status)) return "posted";
        if (attentionStatuses.has(status)) return "attention";
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
      "WWW-Authenticate": 'Basic realm="X Posting Admin", charset="UTF-8"'
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
