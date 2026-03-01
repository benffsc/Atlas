"use client";

export type EntryMode = "phone" | "paper" | "complete";

interface EntryModeSelectorProps {
  value: EntryMode;
  onChange: (mode: EntryMode) => void;
}

const MODES: { value: EntryMode; label: string; description: string; icon: string }[] = [
  {
    value: "phone",
    label: "Phone Intake",
    description: "Taking a call, entering info in real-time",
    icon: "📞",
  },
  {
    value: "paper",
    label: "Paper Entry",
    description: "Transcribing a filled paper call sheet",
    icon: "📋",
  },
  {
    value: "complete",
    label: "Quick Complete",
    description: "Recording finished field work",
    icon: "✅",
  },
];

export default function EntryModeSelector({ value, onChange }: EntryModeSelectorProps) {
  return (
    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
      <label className="block text-sm font-medium text-gray-700 mb-3">
        Entry Mode
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {MODES.map((mode) => (
          <button
            key={mode.value}
            type="button"
            onClick={() => onChange(mode.value)}
            className={`
              relative flex flex-col items-center p-4 rounded-lg border-2 transition-all
              ${
                value === mode.value
                  ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                  : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
              }
            `}
          >
            <div
              className={`
                flex items-center justify-center w-10 h-10 rounded-full mb-2 text-xl
                ${value === mode.value ? "bg-blue-500 text-white" : "bg-gray-100"}
              `}
            >
              {mode.icon}
            </div>
            <span
              className={`text-sm font-medium ${
                value === mode.value ? "text-blue-900" : "text-gray-900"
              }`}
            >
              {mode.label}
            </span>
            <span
              className={`text-xs mt-1 text-center ${
                value === mode.value ? "text-blue-700" : "text-gray-500"
              }`}
            >
              {mode.description}
            </span>
            {value === mode.value && (
              <div className="absolute top-2 right-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full" />
              </div>
            )}
          </button>
        ))}
      </div>

      {value === "complete" && (
        <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-md">
          <p className="text-sm text-green-800">
            <strong>Quick Complete mode:</strong> This will create a request and immediately mark it as completed.
            Use this for field work that has already been finished.
          </p>
        </div>
      )}
    </div>
  );
}
