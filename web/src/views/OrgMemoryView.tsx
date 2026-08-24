import { useEffect, useState } from "react";
import { OrgMemory, getOrgMemory, putOrgMemory } from "../api";
import { isDemoMode } from "../demoApi";

type Draft = Omit<OrgMemory, "updated_at_utc">;

const EMPTY: Draft = {
  mission: "",
  values: [],
  audience: [],
  product_lines: [],
  constraints: [],
  voice_and_taste: "",
};

export default function OrgMemoryView() {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    getOrgMemory()
      .then((o) => setDraft(o))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setError("");
    try {
      const saved = await putOrgMemory(draft);
      setDraft(saved);
      setToast("已保存 ✓");
      setTimeout(() => setToast(""), 2200);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (loading) return <div className="muted">加载中…</div>;

  return (
    <div>
      <p className="lead">
        这里写得越准，<span className="em">内阁越能在你允许时理解长期目标与现实边界</span>。
        {isDemoMode ? "档案只保存在当前浏览器，不会上传或发送给外部模型。" : "档案只保存在本地；默认不发送给外部模型，需在每轮圆桌或单聊中主动勾选。"}
      </p>

      <div className="card">
        <Field label="长期方向" hint="你长期想创造、守护或改变什么">
          <textarea value={draft.mission} onChange={(e) => setDraft({ ...draft, mission: e.target.value })} style={{ minHeight: 70 }} />
        </Field>
        <ListField label="价值观" value={draft.values} onChange={(v) => setDraft({ ...draft, values: v })} />
        <ListField label="关键关系人 / 受影响者" value={draft.audience} onChange={(v) => setDraft({ ...draft, audience: v })} />
        <ListField label="业务、资产、责任或人生主线" value={draft.product_lines} onChange={(v) => setDraft({ ...draft, product_lines: v })} />
        <ListField label="现实约束" value={draft.constraints} onChange={(v) => setDraft({ ...draft, constraints: v })} />
        <Field label="讨论偏好" hint="你希望顾问怎样挑战你、怎样表达事实与不确定性">
          <textarea value={draft.voice_and_taste} onChange={(e) => setDraft({ ...draft, voice_and_taste: e.target.value })} style={{ minHeight: 60 }} />
        </Field>
        <button className="primary" onClick={save}>
          保存决策档案
        </button>
      </div>

      {toast && <div className="toast">{toast}</div>}
      {error && <div className="card error">操作失败：{error}</div>}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="form-field">
      <label>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function ListField({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <Field label={label} hint="每行一条">
      <textarea
        value={value.join("\n")}
        onChange={(e) => onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
        style={{ minHeight: 80 }}
      />
    </Field>
  );
}
