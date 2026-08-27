"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  MonoLink,
  SectionLabel,
  Skeleton,
} from "@devdigest/ui";
import type { Risk } from "@devdigest/shared";
import { formatCost } from "@/lib/cost";
import {
  usePrBrief,
  useGenerateBrief,
  type BriefResponse,
  type ReviewFocus,
} from "@/lib/hooks/brief";
import {
  MAX_FOCUS,
  MAX_RISKS,
  MOVED_INPUT_LABEL,
  RISK_META,
  middleTruncate,
  splitFileRef,
} from "./constants";
import { s } from "./styles";

interface WhyRiskCardProps {
  prId: string | null | undefined;
  /**
   * Jump to a file (and line) on the Files tab. Supplied by the PR page as
   * `openFileFromBrief`; the review-focus list is its only caller.
   */
  onOpenFile?: (path: string, line?: number) => void;
}

/**
 * Why & Risk — what this PR changes, why, what could go wrong, and what to
 * read first.
 *
 * The read path is cache-only: `usePrBrief` never starts an assembly, so the
 * card is safe to hold open on the PR page and the model is only ever called
 * from a click. "No brief stored" is an explicit outcome (`data === null`),
 * not an error — it gets the empty state with a Generate action, and `isError`
 * stays reserved for a genuine read failure.
 *
 * Regenerate is offered on EVERY rendered brief, current or not. `out_of_date`
 * is derived from the LOCAL half of the state fingerprint only; an edited
 * linked issue or reference document moves the remote half, which the read
 * path cannot see. Gating the button on the marker would leave a reader with
 * no way at all to pick those edits up.
 */
export function WhyRiskCard({ prId, onOpenFile }: WhyRiskCardProps) {
  const t = useTranslations("brief");
  const { data, isLoading, isError } = usePrBrief(prId);
  const generate = useGenerateBrief(prId);

  if (isLoading) {
    return (
      <Card>
        <SectionLabel icon="Lightbulb">{t("title")}</SectionLabel>
        <div style={s.skeletonRows}>
          <Skeleton width="85%" />
          <Skeleton width="70%" />
          <Skeleton width="50%" />
        </div>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <SectionLabel icon="Lightbulb">{t("title")}</SectionLabel>
        <EmptyState icon="AlertTriangle" title={t("loadFailed")} />
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <SectionLabel icon="Lightbulb">{t("title")}</SectionLabel>
        <EmptyState
          icon="Lightbulb"
          title={t("unavailable")}
          body={t("unavailableHint")}
          cta={t("generate")}
          // `mutate` takes a variables object under this TanStack version; an
          // omitted argument makes the call signature ambiguous.
          onCta={() => generate.mutate({})}
          ctaLoading={generate.isPending}
        />
      </Card>
    );
  }

  const meta = RISK_META[data.risk_level];
  const risks = data.risks.slice(0, MAX_RISKS);
  const focus = data.review_focus.slice(0, MAX_FOCUS);
  const movedInputs = data.moved_inputs.map((i) => MOVED_INPUT_LABEL[i]).join(", ");
  const impactUnknown = !data.inputs_used.includes("blast");

  return (
    <Card>
      <SectionLabel
        icon="Lightbulb"
        right={
          <span style={s.riskLevelWrap}>
            <span style={s.riskLevelLabel}>{t("riskLevel.label")}</span>
            {/* Word + icon, never colour alone. */}
            <Badge color={meta.color} bg={meta.bg} icon={meta.icon}>
              {t(`riskLevel.${meta.labelKey}`)}
            </Badge>
          </span>
        }
      >
        {t("title")}
      </SectionLabel>

      <div style={s.block}>
        <div style={s.blockHead}>{t("block.what")}</div>
        <p style={s.prose}>{data.what}</p>
      </div>

      <div style={s.block}>
        <div style={s.blockHead}>{t("block.why")}</div>
        <p style={s.prose}>{data.why}</p>
      </div>

      <div style={s.block}>
        <div style={s.blockHead}>{t("block.risks")}</div>
        {risks.length === 0 ? (
          <div style={s.empty}>{t("noRisks")}</div>
        ) : (
          <ul style={s.riskList}>
            {risks.map((risk, i) => (
              <RiskRow
                key={`${risk.kind}:${risk.title}:${i}`}
                risk={risk}
                onOpenFile={onOpenFile}
              />
            ))}
          </ul>
        )}
        {impactUnknown && (
          <div style={s.caveat}>
            <Icon.AlertTriangle size={13} />
            <span>{t("impactUnknown")}</span>
          </div>
        )}
      </div>

      <div style={s.block}>
        <div style={s.blockHead}>{t("reviewFocus")}</div>
        {focus.length === 0 ? (
          // No substitution: an empty focus list means grounding kept nothing,
          // and a changed file picked at random would read as a model judgement
          // it never made.
          <div style={s.empty}>{t("noFocus")}</div>
        ) : (
          <ul style={s.focusList}>
            {focus.map((f, i) => (
              <FocusRow key={`${f.file}:${f.line ?? ""}:${i}`} focus={f} onOpenFile={onOpenFile} />
            ))}
          </ul>
        )}
        {data.discarded_refs > 0 && (
          <div style={s.caveat}>
            <Icon.Filter size={13} />
            <span>{t("notInDiff", { count: data.discarded_refs })}</span>
          </div>
        )}
      </div>

      <Footer
        brief={data}
        onRegenerate={() => generate.mutate({ regenerate: true })}
        regenerating={generate.isPending}
      >
        {data.out_of_date && (
          <div style={s.outOfDate}>
            <Icon.AlertTriangle size={13} />
            <span>
              {t("outOfDate.label")} — {t("outOfDate.moved", { inputs: movedInputs })}
            </span>
          </div>
        )}
      </Footer>
    </Card>
  );
}

function RiskRow({
  risk,
  onOpenFile,
}: {
  risk: Risk;
  onOpenFile?: (path: string, line?: number) => void;
}) {
  const t = useTranslations("brief");
  const rm = RISK_META[risk.severity];
  return (
    <li style={s.riskItem}>
      <div style={s.riskHead}>
        <Badge color={rm.color} bg={rm.bg} icon={rm.icon}>
          {t(`riskLevel.${rm.labelKey}`)}
        </Badge>
        <span style={s.riskTitle}>{risk.title}</span>
        {risk.kind && <span style={s.riskKind}>{risk.kind}</span>}
      </div>
      <p style={s.riskBody}>{risk.explanation}</p>
      {risk.file_refs.length > 0 && (
        <div style={s.refRow}>
          {risk.file_refs.map((ref) => (
            <FileRef key={ref} refText={ref} onOpenFile={onOpenFile} />
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * One `file_refs` entry as a clickable reference.
 *
 * `MonoLink`'s `onClick` variant, which renders a real `<button>` — so Enter
 * and Space activate it for free and it lands in the tab order, which a styled
 * `<span onClick>` would not.
 */
function FileRef({
  refText,
  onOpenFile,
}: {
  refText: string;
  onOpenFile?: (path: string, line?: number) => void;
}) {
  const { file, line } = splitFileRef(refText);
  return (
    <MonoLink onClick={() => onOpenFile?.(file, line)}>
      <span style={s.srOnly}>{refText}</span>
      <span aria-hidden="true" title={refText}>
        {middleTruncate(refText)}
      </span>
    </MonoLink>
  );
}

/**
 * One "read this first" entry: the reference, then the reason after an em
 * dash. The button ANNOUNCES all three — file, line and reason — through the
 * visually-hidden label, because the visible path is middle-truncated and the
 * visible reason sits outside the button (it would otherwise be announced
 * twice, and in the monospace face the reference needs and prose does not).
 */
function FocusRow({
  focus,
  onOpenFile,
}: {
  focus: ReviewFocus;
  onOpenFile?: (path: string, line?: number) => void;
}) {
  const ref = focus.line != null ? `${focus.file}:${focus.line}` : focus.file;
  return (
    <li style={s.focusItem}>
      <MonoLink onClick={() => onOpenFile?.(focus.file, focus.line ?? undefined)}>
        <span style={s.srOnly}>{`${ref} — ${focus.reason}`}</span>
        <span aria-hidden="true" title={ref}>
          {middleTruncate(ref)}
        </span>
      </MonoLink>
      <span aria-hidden="true" style={s.focusReason}>{`— ${focus.reason}`}</span>
    </li>
  );
}

function Footer({
  brief,
  onRegenerate,
  regenerating,
  children,
}: {
  brief: BriefResponse;
  onRegenerate: () => void;
  regenerating: boolean;
  children?: React.ReactNode;
}) {
  const t = useTranslations("brief");
  const hasTokens = brief.tokens_in != null || brief.tokens_out != null;
  return (
    <div style={s.footer}>
      {brief.model && <span style={s.meta}>{brief.model}</span>}
      <span style={s.meta}>{formatCost(brief.cost_usd)}</span>
      {hasTokens && (
        <span style={s.meta} className="tnum">
          {brief.tokens_in ?? 0} → {brief.tokens_out ?? 0}
        </span>
      )}
      <span style={s.spacer} />
      <Button
        kind="ghost"
        size="sm"
        icon="RefreshCw"
        onClick={onRegenerate}
        loading={regenerating}
      >
        {t("regenerate")}
      </Button>
      {children}
    </div>
  );
}
