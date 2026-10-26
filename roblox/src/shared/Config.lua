-- Match, movement, and scale constants for the Roblox v1.
-- Distances in the COCS data are metres. SCALE converts them to studs.

local Config = {
	SCALE = 3,
	-- HumanoidRootPart center sits this many studs above the floor (HipHeight 2 + half of a 2-stud root).
	HIP_OFFSET = 3,

	TIME_LIMIT = 300,
	FRAG_LIMIT = 15,
	RESPAWN = 2,
	PROTECTION = 1.5,
	INTERMISSION = 12,
	-- Humans plus bots. Warmup (no humans yet) still fields ROSTER - 1 bots.
	ROSTER = 5,

	SPRINT = 1.375,
	JUMP_METRES = 1.5,
	GRAVITY = 140,

	ARMOR_ABSORB = 0.6,
	ARMOR_CAP = 100,
	-- A hit still counts as yours if they fall out within this window.
	ASSIST_WINDOW = 6,

	STARTER_ROCKET = 6,
	STARTER_SCATTER = 10,
}

function Config.studs(metres)
	return metres * Config.SCALE
end

return Config
