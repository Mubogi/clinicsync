import { useState, useEffect, useMemo, useRef } from "react";
import { Search, BookOpen, X } from "lucide-react";
import { apiFetch } from "../lib/api.js";

// Uganda National Drug Library picker — search/select medicines instead of typing.
// Used in Inventory (add item) and the first-time onboarding flow.
export default function MedicineLibrary({
  onSelect,
  onClose,
  title = "Select from Uganda drug library",
  categoryFilter = "",
  exclude = [],
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(categoryFilter);
  const [meds, setMeds] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [limit, setLimit] = useState(40);
  const inputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingMore(true);
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (category) params.set("category", category);
    params.set("limit", String(limit));
    apiFetch(`/library/medicines?${params.toString()}`)
      .then((d) => {
        if (cancelled) return;
        setMeds((d && d.medicines) || []);
        if (!cancelled && d && d.categories) setCategories(d.categories);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingMore(false);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, category, limit]);

  const filtered = useMemo(() => {
    if (!exclude.length) return meds;
    return meds.filter((m) => !exclude.includes(m.name));
  }, [meds, exclude]);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-start justify-center p-4 pt-[6vh] overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen size={18} className="text-emerald-600" />
            <h3 className="font-bold text-slate-900">{title}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-100 space-y-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(40);
              }}
              placeholder="Search Paracetamol, Amoxicillin, Coartem…"
              className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => setCategory("")}
              className={`text-[11px] px-2.5 py-1 rounded-full border ${!category ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"}`}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`text-[11px] px-2.5 py-1 rounded-full border ${category === c ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="text-center text-sm text-slate-400 py-10">Loading medicine library…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-sm text-slate-400 py-10">
              No medicines match “{query}”.
              <div className="text-xs text-slate-300 mt-2">You can still add it manually afterwards.</div>
            </div>
          ) : (
            <ul className="divide-y divide-slate-50">
              {filtered.map((m) => (
                <li key={m.name}>
                  <button
                    onClick={() => onSelect(m)}
                    className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-emerald-50/60 transition-colors flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-800">{m.name}</div>
                      <div className="text-[11px] text-slate-400">
                        {m.genericName} · {m.category}
                        {m.pack && m.pack.stripsPerBox ? ` · ${m.pack.stripsPerBox} strips/box` : ""}
                      </div>
                    </div>
                    <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full shrink-0">Add</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {meds.length >= limit && (
            <button
              onClick={() => setLimit((l) => l + 40)}
              className="w-full mt-2 text-center text-xs text-emerald-600 font-medium py-3 hover:bg-emerald-50 rounded-lg"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 text-[11px] text-slate-400">
          <span className="font-medium text-slate-500">{meds.length} results</span> · sources: NDA / MoH Uganda drug list (indicative prices — verify at setup)
        </div>
      </div>
    </div>
  );
}