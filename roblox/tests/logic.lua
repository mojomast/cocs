-- Pure checks for falloff, spread, splash, and The Exchange floor.
-- Run from roblox/:  lua5.4 tests/logic.lua
-- No Roblox APIs. The luau CLI sandbox does not ship io, so use Lua 5.4.

local function readAll(path)
	local file = assert(io.open(path, "r"))
	local source = file:read("*a")
	file:close()
	return source
end

local function loadModule(path)
	local source = readAll(path)
	local chunk, err = load(source, path)
	if not chunk then
		error(err)
	end
	return chunk()
end

local Weapons = loadModule("src/shared/Weapons.lua")
local Arena = loadModule("src/shared/Arena.lua")
local Operators = loadModule("src/shared/Operators.lua")

local function near(a, b, eps)
	eps = eps or 1e-6
	if math.abs(a - b) > eps then
		error(string.format("expected %s, got %s", tostring(b), tostring(a)))
	end
end

local pulse = Weapons.get("pulse")
near(Weapons.falloff(pulse, 10), 1)
near(Weapons.falloff(pulse, 16), 1)
near(Weapons.falloff(pulse, 70), 0.6)
near(Weapons.falloff(pulse, 200), 0.6)
near(Weapons.falloff(pulse, 43), 1 + (0.6 - 1) * ((43 - 16) / (70 - 16)))

local scatter = Weapons.get("scatter")
near(Weapons.falloff(scatter, 0), 1)
near(Weapons.falloff(scatter, 24), 0.4)

near(Weapons.splashFraction(0, 4), 1)
near(Weapons.splashFraction(2, 4), 0.5)
near(Weapons.splashFraction(4, 4), 0)
near(Weapons.splashFraction(5, 4), 0)

local rocket = Weapons.get("rocket")
near(Weapons.effectiveSpread(rocket, 0, 0, false), rocket.bloom.base)
local sprayed = Weapons.addSpread(pulse, 0)
near(sprayed, pulse.bloom.perShot)
local capped = pulse.bloom.max
for _ = 1, 40 do
	capped = Weapons.addSpread(pulse, capped)
end
near(capped, pulse.bloom.max)
near(Weapons.recoverSpread(pulse, 0.05, 0.2), 0.05 - 0.1 * 0.2)

local moving = Weapons.effectiveSpread(pulse, 0.02, 1, true)
local expected = (0 + pulse.bloom.base + 0.02 + pulse.bloom.moveFactor) * 1.3
near(moving, expected)

near(Arena.floorMetres(0, 10), 0)
near(Arena.floorMetres(0, -12), 3.8)
near(Arena.floorMetres(-11, -12), 3.8)
near(Arena.floorMetres(-11, 3), 0)
near(Arena.floorMetres(-11, -4), (3 - -4) / 12 * 3.8)
near(Arena.floorMetres(11, -9), 3.8)
near(Arena.floorMetres(0, -7.5), 0)
assert(Arena.outOfBounds(0, -7, 0))
assert(not Arena.outOfBounds(0, 1, 0))
assert(Arena.outOfBounds(20, 1, 0))

local spawn = Arena.pickSpawn({}, function()
	return 1
end)
assert(spawn.x ~= nil and spawn.z ~= nil)

local far = Arena.pickSpawn({ { x = 11, z = 10 } }, function()
	return 1
end)
-- Farthest from the east pit spawn should not be that same pad.
assert(not (far.x == 11 and far.z == 10))

assert(#Operators.all() >= 4)
local claude = Operators.get("claude")
assert(claude.harness == "guardrail")
assert(Operators.harnessOf(claude).resist == 0.5)
assert(Operators.get("mistral").speed > Operators.get("meta").speed)
assert(Operators.get("deepseek").health > Operators.get("kimi").health)
assert(Weapons.defs.pulse.ammo == math.huge)
assert(Weapons.defs.rocket.splash > Weapons.defs.rocket.damage)
assert(Weapons.defs.scatter.pellets == 8)

print("roblox logic tests passed")
