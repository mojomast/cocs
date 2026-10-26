-- Three weapons with the web game's cadence, falloff, and bloom.
-- Pulse is the unlimited hitscan rifle. Rocket is a slow splash projectile.
-- Scatter is a close pellet burst. Distances here are metres.

local Weapons = {}

local function clamp(x, a, b)
	if x < a then
		return a
	end
	if x > b then
		return b
	end
	return x
end

Weapons.order = { "pulse", "rocket", "scatter" }

Weapons.defs = {
	pulse = {
		id = "pulse",
		name = "Pulse Rifle",
		short = "PULSE",
		slot = 1,
		kind = "hitscan",
		damage = 11,
		interval = 0.1,
		range = 70,
		falloff = { start = 16, ["end"] = 70, min = 0.6 },
		color = "70ffe6",
		ammo = math.huge,
		cap = math.huge,
		recoil = { kick = 0.012, recover = 14 },
		bloom = { base = 0.006, perShot = 0.006, max = 0.06, recovery = 0.1, moveFactor = 0.035 },
		blurb = "Unlimited hitscan. Spray and it opens up.",
	},
	rocket = {
		id = "rocket",
		name = "Rocket Launcher",
		short = "ROCKET",
		slot = 2,
		kind = "projectile",
		damage = 35,
		splash = 60,
		radius = 4,
		speed = 36,
		interval = 0.85,
		range = 60,
		color = "ffad61",
		ammo = 6,
		cap = 18,
		recoil = { kick = 0.05, recover = 9 },
		bloom = { base = 0.004, perShot = 0.012, max = 0.05, recovery = 0.14, moveFactor = 0 },
		blurb = "Slow rocket, heavy splash, hurts you too.",
	},
	scatter = {
		id = "scatter",
		name = "Scattergun",
		short = "SCATTER",
		slot = 3,
		kind = "pellets",
		damage = 8.5,
		pellets = 8,
		spread = 0.115,
		interval = 0.78,
		range = 24,
		falloff = { start = 6, ["end"] = 24, min = 0.4 },
		color = "ffde87",
		ammo = 10,
		cap = 30,
		recoil = { kick = 0.08, recover = 10.5 },
		bloom = { base = 0.018, perShot = 0.018, max = 0.11, recovery = 0.18, moveFactor = 0.08 },
		blurb = "Eight pellets. Awful at range, rude up close.",
	},
}

function Weapons.get(id)
	return Weapons.defs[id]
end

-- Full damage inside `start`, tapering to `min` at `end`. Metres.
function Weapons.falloff(weapon, distance)
	local fall = weapon and weapon.falloff
	if not fall or type(distance) ~= "number" or distance ~= distance then
		return 1
	end
	local startAt = fall.start or 0
	local endAt = fall["end"]
	local minimum = fall.min
	if type(minimum) ~= "number" then
		minimum = 1
	end
	if distance <= startAt then
		return 1
	end
	if type(endAt) ~= "number" or not (endAt > startAt) then
		return minimum
	end
	local t = clamp((distance - startAt) / (endAt - startAt), 0, 1)
	return 1 + (minimum - 1) * t
end

function Weapons.splashFraction(distance, radius)
	if type(radius) ~= "number" or not (radius > 0) then
		return 0
	end
	if type(distance) ~= "number" or distance ~= distance then
		return 0
	end
	if distance <= 0 then
		return 1
	end
	if distance >= radius then
		return 0
	end
	return 1 - distance / radius
end

-- Matches game/core.mjs effectiveSpread: base + accumulated bloom + movement, then sprint.
function Weapons.effectiveSpread(weapon, accumulated, speedFrac, sprinting)
	local bloom = weapon.bloom or {}
	local spread = (weapon.spread or 0) + (bloom.base or 0) + (accumulated or 0)
	spread = spread + (bloom.moveFactor or 0) * clamp(speedFrac or 0, 0, 1)
	if sprinting then
		spread = spread * 1.3
	end
	return spread
end

function Weapons.recoverSpread(weapon, accumulated, dt)
	local bloom = weapon.bloom or {}
	local recovery = bloom.recovery or 0.1
	local nextValue = (accumulated or 0) - recovery * dt
	if nextValue < 0 then
		return 0
	end
	return nextValue
end

function Weapons.addSpread(weapon, accumulated)
	local bloom = weapon.bloom or {}
	local cap = bloom.max or 0
	local nextValue = (accumulated or 0) + (bloom.perShot or 0)
	if nextValue > cap then
		return cap
	end
	return nextValue
end

return Weapons
