-- Nine COCS operators from game/data.mjs (health, spawn armor, base speed in m/s).
-- v1 locks each operator to one signature harness. Claude stays on Guardrail.
-- The web game's free harness matrix is deferred.

local Operators = {}

local HARNESSES = {
	codex = {
		id = "codex",
		name = "Codex",
		power = "Recompile",
		cooldown = 16,
		duration = 0,
		heal = 45,
		blurb = "Patches 45 health back in. Every test passes. Probably.",
	},
	guardrail = {
		id = "guardrail",
		name = "Claude Code",
		power = "Guardrail",
		cooldown = 10,
		duration = 3.5,
		resist = 0.5,
		blurb = "Halves incoming damage while it asks if you are sure.",
	},
	openclaw = {
		id = "openclaw",
		name = "OpenClaw",
		power = "Claw Burst",
		cooldown = 10,
		duration = 0,
		radius = 6,
		damage = 30,
		knock = 14,
		lift = 4,
		blurb = "A radial pulse that shoves enemies back and hurts.",
	},
	hermes = {
		id = "hermes",
		name = "Hermes",
		power = "Courier Rush",
		cooldown = 10,
		duration = 3.5,
		speed = 1.6,
		blurb = "Next-day-delivery speed. The window closes in 3.5 seconds.",
	},
	contextjam = {
		id = "contextjam",
		name = "Roo Code",
		power = "Context Jam",
		cooldown = 12,
		duration = 3,
		radius = 8,
		slow = 0.5,
		blurb = "Nearby enemies drown in context and move at half speed.",
	},
}

-- Stats match game/data.mjs, which is ahead of the older README table.
local LIST = {
	{
		id = "chatgpt",
		name = "ChatGPT",
		tag = "THE PEOPLE PLEASER",
		blurb = "Opens every round with a refusal, then helps anyway.",
		health = 100,
		armor = 5,
		speed = 8.6,
		color = "57e6cd",
		accent = "e3f7ef",
		harness = "codex",
		silhouette = "ball",
	},
	{
		id = "claude",
		name = "Claude",
		tag = "THE SAFETY OFFICER",
		blurb = "Won't pull the trigger until the alignment review clears.",
		health = 120,
		armor = 10,
		speed = 7.8,
		color = "f29d71",
		accent = "f8e4cf",
		harness = "guardrail",
		silhouette = "stripe",
	},
	{
		id = "grok",
		name = "Grok",
		tag = "THE REPLY GUY",
		blurb = "Trained on the timeline. Argues with everyone in the lobby.",
		health = 110,
		armor = 0,
		speed = 8.9,
		color = "b5c5d4",
		accent = "8aa0b3",
		harness = "openclaw",
		silhouette = "antenna",
	},
	{
		id = "meta",
		name = "Meta",
		tag = "THE OPEN-WEIGHT DAD",
		blurb = "Slow, armored, and happy to bury you in context.",
		health = 104,
		armor = 20,
		speed = 7.6,
		color = "57b9ff",
		accent = "b0edff",
		harness = "contextjam",
		silhouette = "rings",
	},
	{
		id = "gemini",
		name = "Gemini",
		tag = "THE REVISER",
		blurb = "Generated nine champions. Quietly deleted eight of them.",
		health = 100,
		armor = 10,
		speed = 9,
		color = "6fa8ff",
		accent = "fff0c3",
		harness = "hermes",
		silhouette = "visor",
	},
	{
		id = "deepseek",
		name = "DeepSeek",
		tag = "THE PRICE CUTTER",
		blurb = "Frontier health at bus-fare speed. Brings a repair build.",
		health = 126,
		armor = 0,
		speed = 7.7,
		color = "56c5f2",
		accent = "c3d9f9",
		harness = "codex",
		silhouette = "fin",
	},
	{
		id = "mistral",
		name = "Mistral",
		tag = "THE LE COQ",
		blurb = "The fastest operator in the colosseum. Permanently mid-sprint.",
		health = 112,
		armor = 0,
		speed = 9.2,
		color = "ffbd59",
		accent = "ffe1a1",
		harness = "hermes",
		silhouette = "steps",
	},
	{
		id = "kimi",
		name = "Kimi",
		tag = "THE CONTEXT HOARDER",
		blurb = "Fragile, quick, and armed with a shove.",
		health = 90,
		armor = 10,
		speed = 8.7,
		color = "ff82b2",
		accent = "fbe1ed",
		harness = "openclaw",
		silhouette = "halo",
	},
	{
		id = "qwen",
		name = "Qwen",
		tag = "THE SHIPPING CONTAINER",
		blurb = "Ships inside a billion fridges. Delivers speed on request.",
		health = 108,
		armor = 10,
		speed = 8.5,
		color = "b797ff",
		accent = "eee6ff",
		harness = "hermes",
		silhouette = "shoulders",
	},
}

local BY_ID = {}
for _, operator in ipairs(LIST) do
	BY_ID[operator.id] = operator
end

function Operators.all()
	return LIST
end

function Operators.get(id)
	if type(id) ~= "string" then
		return nil
	end
	return BY_ID[id]
end

function Operators.harness(id)
	return HARNESSES[id]
end

function Operators.harnessOf(operator)
	return HARNESSES[operator.harness]
end

return Operators
