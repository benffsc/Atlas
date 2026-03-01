"use client";

export interface CompletionData {
  final_cat_count: number | "";
  eartips_observed: number | "";
  cats_altered_today: number | "";
  observation_notes: string;
  colony_complete: boolean;
  requester_followup: boolean;
  refer_partner: boolean;
  partner_name: string;
}

interface CompletionSectionProps {
  value: CompletionData;
  onChange: (data: CompletionData) => void;
}

export const DEFAULT_COMPLETION_DATA: CompletionData = {
  final_cat_count: "",
  eartips_observed: "",
  cats_altered_today: "",
  observation_notes: "",
  colony_complete: false,
  requester_followup: false,
  refer_partner: false,
  partner_name: "",
};

export default function CompletionSection({ value, onChange }: CompletionSectionProps) {
  const updateField = <K extends keyof CompletionData>(
    field: K,
    fieldValue: CompletionData[K]
  ) => {
    onChange({ ...value, [field]: fieldValue });
  };

  return (
    <div className="bg-green-50 rounded-lg border-2 border-green-300 p-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xl">✅</span>
        <h3 className="text-lg font-semibold text-green-800">Field Work Completion</h3>
      </div>

      <div className="space-y-4">
        {/* Cat Counts Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Final Cat Count
            </label>
            <input
              type="number"
              min="0"
              value={value.final_cat_count}
              onChange={(e) =>
                updateField(
                  "final_cat_count",
                  e.target.value === "" ? "" : parseInt(e.target.value, 10)
                )
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-green-500"
              placeholder="Total cats at location"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Eartips Observed
            </label>
            <input
              type="number"
              min="0"
              value={value.eartips_observed}
              onChange={(e) =>
                updateField(
                  "eartips_observed",
                  e.target.value === "" ? "" : parseInt(e.target.value, 10)
                )
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-green-500"
              placeholder="Already fixed"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Cats Altered Today
            </label>
            <input
              type="number"
              min="0"
              value={value.cats_altered_today}
              onChange={(e) =>
                updateField(
                  "cats_altered_today",
                  e.target.value === "" ? "" : parseInt(e.target.value, 10)
                )
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-green-500"
              placeholder="Fixed this visit"
            />
          </div>
        </div>

        {/* Observation Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Observation Notes
          </label>
          <textarea
            value={value.observation_notes}
            onChange={(e) => updateField("observation_notes", e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-green-500"
            placeholder="Notes from the field visit (cat descriptions, access issues, etc.)"
          />
        </div>

        {/* Checkboxes */}
        <div className="space-y-3 pt-2">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={value.colony_complete}
              onChange={(e) => updateField("colony_complete", e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
            />
            <span className="text-sm text-gray-700">
              <strong>Colony work complete</strong> - All cats at this location have been altered
            </span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={value.requester_followup}
              onChange={(e) => updateField("requester_followup", e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
            />
            <span className="text-sm text-gray-700">
              <strong>Requester will follow up</strong> - They will contact us about remaining cats
            </span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={value.refer_partner}
              onChange={(e) => {
                updateField("refer_partner", e.target.checked);
                if (!e.target.checked) {
                  updateField("partner_name", "");
                }
              }}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
            />
            <span className="text-sm text-gray-700">
              <strong>Refer to partner org</strong> - Location will be handled by another organization
            </span>
          </label>

          {value.refer_partner && (
            <div className="ml-7">
              <select
                value={value.partner_name}
                onChange={(e) => updateField("partner_name", e.target.value)}
                className="w-full sm:w-64 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-green-500"
              >
                <option value="">Select partner...</option>
                <option value="NBAS">NBAS (North Bay Animal Services)</option>
                <option value="SCAS">SCAS (Sonoma County Animal Services)</option>
                <option value="Marin Humane">Marin Humane</option>
                <option value="Fix Our Ferals">Fix Our Ferals</option>
                <option value="Other">Other</option>
              </select>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
