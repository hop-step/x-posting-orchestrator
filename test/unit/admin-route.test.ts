import { describe, expect, it } from "vitest";
import { createApp } from "../../src/http/app";

describe("admin route", () => {
  it("requires Basic authentication", async () => {
    const app = createApp("# Test AI documentation");
    const response = await app.request(
      "/admin",
      {},
      {
        ADMIN_BASIC_USERNAME: "admin",
        ADMIN_BASIC_PASSWORD: "secret",
        ALLOWED_CORS_ORIGINS: ""
      }
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Basic");
  });

  it("serves the lightweight admin UI", async () => {
    const app = createApp("# Test AI documentation");
    const response = await app.request(
      "/admin",
      {
        headers: {
          Authorization: `Basic ${Buffer.from("admin:secret").toString("base64")}`
        }
      },
      {
        ADMIN_BASIC_USERNAME: "admin",
        ADMIN_BASIC_PASSWORD: "secret",
        ALLOWED_CORS_ORIGINS: ""
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("X投稿くん");
    expect(html).toContain("Xアカウント");
    expect(html).toContain("collapsible-panel");
    expect(html).toContain("accountSummaryMeta");
    expect(html).toContain("/v1/x/accounts");
    expect(html).toContain("X接続");
    expect(html).toContain('method: "DELETE"');
    expect(html).toContain("APIクライアント");
    expect(html).toContain("clientSummaryMeta");
    expect(html).toContain("/v1/api-clients");
    expect(html).toContain("clientCardFor");
    expect(html).toContain("updateApiClient");
    expect(html).toContain("updateClientPermission");
    expect(html).toContain("permissionLevels");
    expect(html).toContain("publicationListUrl");
    expect(html).toContain('params.set("statusGroups", "before,attention")');
    expect(html).toContain('params.set("includeProblemDismissals", "true")');
    expect(html).not.toContain('params.set("statusGroups", "posted")');
    expect(html).not.toContain("/v1/publications/problem-dismissals");
    expect(html).toContain("loadPublicationSource");
    expect(html).toContain("ensurePublicationsForFilter");
    expect(html).toContain("loadingState");
    expect(html).toContain("loadedPublicationSources");
    expect(html).toContain("publicationSourceLabels");
    expect(html).toContain("投稿前・問題あり");
    expect(html).toContain("を読み込み中");
    expect(html).not.toContain('fetch("/v1/publications?limit=100"');
    expect(html).toContain('<ul class="publication-list" id="rows">');
    expect(html).toContain('id="dateFilters"');
    expect(html).toContain('id="bulkApprovalBar"');
    expect(html).toContain('id="selectVisibleApprovals"');
    expect(html).toContain("表示中をすべて選択");
    expect(html).toContain('id="approveSelected"');
    expect(html).toContain("選択した投稿を承認");
    expect(html).toContain("publicationDateOptions");
    expect(html).toContain("publicationDateKey");
    expect(html).toContain("dateFilterButton");
    expect(html).toContain("publicationMatchesDateOption");
    expect(html).toContain("それより過去");
    expect(html).toContain("filterLabels");
    expect(html).toContain("publicationCardFor");
    expect(html).toContain("publicationPreviewPanel");
    expect(html).toContain("xPostPreviewFor");
    expect(html).toContain("xPollPreview");
    expect(html).toContain("xMediaPreview");
    expect(html).toContain("openPublicationEditor");
    expect(html).toContain("closePublicationEditor");
    expect(html).toContain("accountNameForPublication");
    expect(html).toContain("accountHandleForPublication");
    expect(html).toContain("x-preview");
    expect(html).toContain("x-thread");
    expect(html).toContain("x-post");
    expect(html).toContain("x-poll-option");
    expect(html).toContain("publication-admin-meta");
    expect(html).toContain("publication-edit-accordion");
    expect(html).toContain("publication-edit-summary-title");
    expect(html).toContain("publication-edit-summary-meta");
    expect(html).toContain("publication-edit-body");
    expect(html).toContain("editSummaryMeta");
    expect(html).toContain("card-title-row");
    expect(html).toContain("card-date");
    expect(html).toContain("compactMeta");
    expect(html).toContain("pollOptionsField");
    expect(html).toContain("setPublicationFormEditing");
    expect(html).toContain("pollOptionInputsFor");
    expect(html).toContain("pollOptionIndex");
    expect(html).toContain("投票選択肢");
    expect(html).toContain("Step 1 投稿内容");
    expect(html).toContain("この投稿は編集できません");
    expect(html).not.toContain('class="stats"');
    expect(html).not.toContain('id="pendingApprovalCount"');
    expect(html).not.toContain('id="problemCount"');
    expect(html).not.toContain('id="readyCount"');
    expect(html).not.toContain("countPublicationSteps");
    expect(html).not.toContain("updateStepCounts");
    expect(html).toContain("groupPublicationsForRows");
    expect(html).toContain("formatDurationMinutes");
    expect(html).toContain("memoCompactMeta");
    expect(html).toContain("Publication ID:");
    expect(html).toContain("approvalGraceSeconds");
    expect(html).toContain("approvalControlFor");
    expect(html).toContain("card-approval-control");
    expect(html).not.toContain("approvalBannerFor");
    expect(html).not.toContain("approval-banner");
    expect(html).toContain("approvePublication");
    expect(html).toContain("approveSelectedPublications");
    expect(html).toContain("requestPublicationApproval");
    expect(html).toContain("bulkApprovalConfirmation");
    expect(html).toContain("selectedApprovalIds");
    expect(html).toContain("isBulkApprovablePublication");
    expect(html).toContain("一括承認中");
    expect(html).toContain("Approved in bulk from admin UI");
    expect(html).toContain("承認後は予約投稿の対象になります");
    expect(html).toContain("件失敗");
    expect(html).toContain("/approve");
    expect(html).toContain("refreshPublicationBundle");
    expect(html).toContain("replacePublicationBundle");
    expect(html).toContain('fetch("/v1/publications/" + encodeURIComponent(publicationId)');
    const cardSource = html.slice(html.indexOf("function publicationCardFor"), html.indexOf("function approvalSelectionFor"));
    expect(cardSource).toContain("titleRow.append(actions)");
    expect(cardSource).toContain("head.append(approvalControl)");
    expect(cardSource).not.toContain("head.append(actions)");
    const previewSource = html.slice(html.indexOf("function xPostPreviewFor"), html.indexOf("function xPollPreview"));
    expect(previewSource).toContain("if (entry.total > 1)");
    expect(previewSource).not.toContain('time.className = "x-time"');
    expect(previewSource).not.toContain("badgeInline(entryStatus(entry))");
    expect(previewSource).not.toContain("footer.append(compactFooterText(entryStatus(entry)))");
    const approveSource = html.slice(html.indexOf("async function approvePublication"), html.indexOf("async function cancelPublication"));
    expect(approveSource).toContain("await refreshPublicationBundle(publication.id)");
    expect(approveSource).not.toContain("reloadCurrentPublications");
    expect(html).toContain("sortPublicationsBySchedule");
    expect(html).toContain('data-filter="pendingApproval"');
    expect(html).toContain('data-filter="problem"');
    expect(html).toContain('data-filter="ready"');
    expect(html).toContain('data-filter="cancelled"');
    expect(html).toContain("キャンセル済み（予定前）");
    expect(html).toContain("isFutureCancelledPublication");
    expect(html).toContain('return isFutureCancelledPublication(publication) ? "cancelled" : "hidden"');
    expect(html).toContain('return isFutureCancelledPublication(entry.publication) ? "cancelled" : "hidden"');
    expect(html).toContain('button.hidden = count === 0');
    expect(html).toContain("normalizeActiveFilter");
    expect(html).toContain("pendingApprovalStatuses");
    expect(html).toContain("readyBeforeStatuses");
    expect(html).toContain("problemStatuses");
    expect(html).toContain("publicationRowCategory");
    expect(html).toContain("stepCategory");
    expect(html).toContain("要確認");
    expect(html).toContain("問題あり");
    expect(html).toContain("予約済");
    expect(html.indexOf('data-filter="problem"')).toBeGreaterThan(html.indexOf('data-filter="pendingApproval"'));
    expect(html.indexOf('data-filter="ready"')).toBeGreaterThan(html.indexOf('data-filter="problem"'));
    expect(html.indexOf('data-filter="cancelled"')).toBeGreaterThan(html.indexOf('data-filter="ready"'));
    expect(html).not.toContain('data-filter="posted"');
    expect(html).not.toContain('data-filter="all"');
    expect(html).not.toContain('id="postedCount"');
    expect(html).not.toContain('id="allCount"');
    expect(html).toContain("canCancelPublication");
    expect(html).toContain("cancelPublication");
    expect(html).toContain("/cancel");
    expect(html).toContain("削除しました");
    expect(html).toContain("canDismissProblemPublication");
    expect(html).toContain("dismissProblemPublication");
    expect(html).toContain("isProblemEntry");
    expect(html).toContain("/problem-dismissal");
    expect(html).toContain("問題ありを確認済みにしました");
    expect(html).toContain("editablePublicationStatuses");
    expect(html).toContain("publicationEditPanel");
    expect(html).toContain("publicationPatchBody");
    expect(html).toContain("editPublication");
    expect(html).toContain('method: "PATCH"');
    expect(html).toContain('type: "datetime-local"');
    expect(html).toContain("localDateTimeWithOffset");
    expect(html).toContain("投稿を保存しました。必要な場合は再承認してください");
    expect(html).not.toContain("承認待ち");
    expect(html).toContain("期限切れ");
    expect(html).toContain("承認しました");
    expect(html).toContain("readStringSet");
    expect(html).toContain("writeStringSet");
    expect(html).not.toContain("splitPreviewAndContinuation");
    expect(html).not.toContain("previewCutIndex");
    expect(html).not.toContain("続き");
    expect(html).not.toContain("compact-details");
    expect(html).not.toContain("全文");
    expect(html).not.toContain("step-block");
    expect(html).not.toContain("full-step-text");
    expect(html).not.toContain("step-children");
    expect(html).not.toContain("step-list");
    expect(html).not.toContain("main-step");
    expect(html).not.toContain("ID / Step");
    expect(html).not.toContain("xAccountId=acc_main");
    expect(html.indexOf('aria-label="APIクライアント"')).toBeGreaterThan(html.indexOf('aria-label="投稿一覧"'));
    expect(html.indexOf('aria-label="APIクライアント"')).toBeGreaterThan(html.indexOf('aria-label="Xアカウント"'));
  });
});
