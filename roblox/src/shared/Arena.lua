-- The Exchange, in metres, following game/maps.mjs and floorAt() in game/core.mjs.
-- Gantry / "north deck" is the -Z end. Ramps climb toward -Z between |x| 8.2 and 14.
-- The Roblox builder scales this by Config.SCALE. Keep floorMetres in sync with that mesh.

local Arena = {
	id = "exchange",
	name = "The Exchange",
	tag = "REACTOR / VERTICAL",
	blurb = "Twin ramps, a raised gantry, and a central reactor. Control the high ground.",
}

-- Inner play space is about 28m across. Walls are centered on ±14.5 with thickness 1.
Arena.spawns = {
	{ x = -11, z = 10 },
	{ x = 11, z = 10 },
	{ x = 0, z = 12 },
	{ x = -11, z = -12 },
	{ x = 11, z = -12 },
	{ x = 0, z = -12 },
	{ x = -4, z = 9 },
	{ x = 4, z = 9 },
}

-- Landmarks bots can path to. Includes both ramps and the gantry, same idea as the web nav graph.
Arena.landmarks = {
	{ x = -11, z = 10 },
	{ x = 11, z = 10 },
	{ x = 0, z = 12 },
	{ x = -11, z = 4 },
	{ x = 11, z = 4 },
	{ x = -11, z = -4 },
	{ x = 11, z = -4 },
	{ x = -11, z = -12 },
	{ x = 11, z = -12 },
	{ x = 0, z = -12 },
	{ x = 0, z = 7 },
	{ x = -10, z = 0 },
	{ x = 10, z = 0 },
	{ x = 0, z = -7.5 },
	{ x = -6, z = -6 },
	{ x = 6, z = -6 },
}

-- Plasma and rail pedestals from the web map become scatter and rocket ammo.
-- v1 only has pulse / rocket / scatter, and the gantry should still reward a power weapon.
Arena.pickups = {
	{ kind = "health", x = -11, z = 7, respawn = 12 },
	{ kind = "health", x = 11, z = 7, respawn = 12 },
	{ kind = "armor", x = 0, z = 7, respawn = 12 },
	{ kind = "rocket", x = -4, z = 0, respawn = 15 },
	{ kind = "scatter", x = 4, z = 0, respawn = 15 },
	{ kind = "rocket", x = 0, z = -12, respawn = 15 },
	{ kind = "health", x = -6, z = -12, respawn = 12 },
	{ kind = "armor", x = 6, z = -12, respawn = 12 },
	{ kind = "scatter", x = 0, z = 11, respawn = 15 },
	{ kind = "mega", x = 0, z = -7.5, respawn = 20 },
	{ kind = "supply", x = -11, z = -7, respawn = 15 },
}

function Arena.floorMetres(x, z)
	local floor = 0
	-- Deck block: center (0, -12), 28 by 6, top at 3.8. Solid, no underpass.
	if math.abs(x) <= 14 and z <= -9 and z >= -15 then
		floor = 3.8
	end
	-- Ramp formula from floorAt: |x| in (8.2, 14), z < 3, and not already on the gantry strip.
	-- Foot is z = 3 (height 0). Top meets the deck at z = -9 (height 3.8).
	if z > -9 and math.abs(x) > 8.2 and math.abs(x) < 14 and z < 3 then
		local ramp = (3 - z) / 12 * 3.8
		if ramp > floor then
			floor = ramp
		end
	end
	return floor
end

function Arena.outOfBounds(x, y, z)
	if y < -6 or y > 24 then
		return true
	end
	if math.abs(x) > 16.5 or math.abs(z) > 16.5 then
		return true
	end
	return false
end

-- Farthest spawn from every living actor. Ties are random so the same pad is not sticky.
function Arena.pickSpawn(occupied, rng)
	rng = rng or math.random
	local bestScore = -math.huge
	local options = {}
	for _, spawn in ipairs(Arena.spawns) do
		local score = math.huge
		if occupied == nil or #occupied == 0 then
			score = 1
		else
			for _, other in ipairs(occupied) do
				local dx = spawn.x - other.x
				local dz = spawn.z - other.z
				local distance = math.sqrt(dx * dx + dz * dz)
				if distance < score then
					score = distance
				end
			end
		end
		if score > bestScore + 0.05 then
			bestScore = score
			options = { spawn }
		elseif math.abs(score - bestScore) <= 0.05 then
			table.insert(options, spawn)
		end
	end
	if #options == 0 then
		return Arena.spawns[1]
	end
	return options[rng(1, #options)]
end

return Arena
