-- Lobby filler. Bots path with PathfindingService, shoot with stale aim and extra error,
-- and use the same Combat.tryFire path as players. They are supposed to be beatable.

local PathfindingService = game:GetService("PathfindingService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local Arena = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Arena"))
local Operators = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Operators"))
local State = require(script.Parent.State)
local Combat = require(script.Parent.Combat)
local Pickups = require(script.Parent.Pickups)

local Bots = {}

local THINK = 0.2

local function now()
	return os.clock()
end

local function flat(vector)
	return Vector3.new(vector.X, 0, vector.Z)
end

local function raySees(actor, target)
	if not actor.head or not target.head then
		return false
	end
	local delta = target.head.Position - actor.head.Position
	if delta.Magnitude < 0.1 then
		return true
	end
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	local exclude = { actor.model }
	if State.cosmetic then
		table.insert(exclude, State.cosmetic)
	end
	params.FilterDescendantsInstances = exclude
	params.IgnoreWater = true
	local hit = workspace:Raycast(actor.head.Position, delta, params)
	if not hit then
		return true
	end
	local model = hit.Instance:FindFirstAncestorOfClass("Model")
	return model == target.model
end

local function nearestEnemy(actor)
	local best = nil
	local bestDistance = math.huge
	local seen = nil
	for _, other in ipairs(State.actors) do
		if other ~= actor and other.alive and other.hrp and actor.hrp then
			local distance = (other.hrp.Position - actor.hrp.Position).Magnitude
			if distance < bestDistance then
				bestDistance = distance
				best = other
			end
			if distance < 90 and raySees(actor, other) then
				if not seen or distance < seen.distance then
					seen = { actor = other, distance = distance }
				end
			end
		end
	end
	return seen and seen.actor or nil, best, bestDistance
end

local function landmarkPosition()
	local mark = Arena.landmarks[math.random(1, #Arena.landmarks)]
	local y = Arena.floorMetres(mark.x, mark.z)
	return Vector3.new(mark.x * Config.SCALE, y * Config.SCALE + Config.HIP_OFFSET, mark.z * Config.SCALE)
end

local function requestPath(actor, goal)
	local brain = actor.brain
	if not brain or brain.computing or not actor.hrp then
		return
	end
	if brain.nextPath and now() < brain.nextPath and (brain.direct or brain.waypoints) then
		brain.direct = goal
		return
	end
	brain.nextPath = now() + 0.8
	brain.computing = true
	brain.goal = goal
	local start = actor.hrp.Position
	task.spawn(function()
		local path = PathfindingService:CreatePath({
			AgentRadius = 1.6,
			AgentHeight = 5,
			AgentCanJump = true,
			WaypointSpacing = 5,
		})
		local ok = pcall(function()
			path:ComputeAsync(start, goal)
		end)
		brain.computing = false
		if not actor.alive or not actor.model or not actor.model.Parent then
			return
		end
		if ok and path.Status == Enum.PathStatus.Success then
			brain.waypoints = path:GetWaypoints()
			brain.wp = 2
		else
			brain.waypoints = nil
			brain.direct = goal
		end
	end)
end

local function chooseWeapon(actor, distance)
	if distance < 18 and (actor.ammo.scatter or 0) > 0 then
		return "scatter"
	end
	if distance > 20 and distance < 55 and (actor.ammo.rocket or 0) > 0 and math.random() < 0.7 then
		return "rocket"
	end
	return "pulse"
end

local function desiredRange(weaponId)
	if weaponId == "scatter" then
		return 8, 16
	end
	if weaponId == "rocket" then
		return 18, 36
	end
	return 16, 38
end

function Bots.ensureBrain(actor)
	if actor.brain then
		return
	end
	actor.brain = {
		computing = false,
		waypoints = nil,
		wp = 1,
		direct = nil,
		goal = nil,
		nextThink = 0,
		aimAt = Vector3.new(),
		target = nil,
		reactAt = 0,
		strafe = 1,
		nextStrafe = 0,
		stuckPos = Vector3.new(),
		stuckClock = 0,
		wantFire = false,
	}
end

local function think(actor)
	local brain = actor.brain
	local visible, nearest, nearestDistance = nearestEnemy(actor)
	local healthFrac = 1
	if actor.humanoid and actor.humanoid.MaxHealth > 0 then
		healthFrac = actor.humanoid.Health / actor.humanoid.MaxHealth
	end

	-- Hurt bots look for health before they pick a fight.
	if healthFrac < 0.45 then
		local pickup = Pickups.nearest(actor, { "health", "mega" }, 30)
		if pickup then
			brain.target = nil
			brain.wantFire = false
			local y = Arena.floorMetres(pickup.x, pickup.z)
			requestPath(actor, Vector3.new(pickup.x * Config.SCALE, y * Config.SCALE + Config.HIP_OFFSET, pickup.z * Config.SCALE))
			return
		end
	end

	if (actor.ammo.rocket or 0) == 0 and (actor.ammo.scatter or 0) < 3 and not visible then
		local pickup = Pickups.nearest(actor, { "rocket", "scatter", "supply" }, 25)
		if pickup and math.random() < 0.5 then
			brain.wantFire = false
			local y = Arena.floorMetres(pickup.x, pickup.z)
			requestPath(actor, Vector3.new(pickup.x * Config.SCALE, y * Config.SCALE + Config.HIP_OFFSET, pickup.z * Config.SCALE))
			return
		end
	end

	local enemy = visible or nearest
	if not enemy or not enemy.hrp then
		brain.target = nil
		brain.wantFire = false
		actor.sprinting = false
		Combat.refreshSpeed(actor)
		requestPath(actor, landmarkPosition())
		return
	end

	if brain.target ~= enemy then
		brain.target = enemy
		brain.reactAt = now() + 0.3 + math.random() * 0.25
	end

	local distance = (enemy.hrp.Position - actor.hrp.Position).Magnitude
	local weaponId = chooseWeapon(actor, distance)
	if actor.weapon ~= weaponId then
		Combat.switchWeapon(actor, weaponId)
	end
	local nearRange, farRange = desiredRange(weaponId)
	local harness = Operators.harnessOf(actor.operator)
	if harness and now() >= (actor.abilityReadyAt or 0) then
		local metres = distance / Config.SCALE
		if harness.id == "codex" and healthFrac < 0.65 then
			Combat.tryAbility(actor)
		elseif harness.id == "guardrail" and healthFrac < 0.72 and visible then
			Combat.tryAbility(actor)
		elseif harness.id == "hermes" and (not visible or metres > 8) then
			Combat.tryAbility(actor)
		elseif (harness.id == "openclaw" or harness.id == "contextjam") and visible and metres < (harness.radius or 8) then
			Combat.tryAbility(actor)
		end
	end

	-- Aim point refreshes on the think tick, so tracking lags a moving target.
	local lead = Vector3.zero
	if weaponId == "rocket" and enemy.hrp then
		local travel = distance / math.max(1, 36 * Config.SCALE)
		lead = flat(enemy.hrp.AssemblyLinearVelocity) * travel * 0.45
	end
	local aim = (enemy.head and enemy.head.Position or enemy.hrp.Position) + lead
	local errorScale = 0.07 + (distance / Config.SCALE) * 0.003
	aim = aim + Vector3.new((math.random() - 0.5) * errorScale * distance, (math.random() - 0.5) * errorScale * distance * 0.4, (math.random() - 0.5) * errorScale * distance)
	brain.aimAt = aim
	brain.wantFire = visible ~= nil and now() >= brain.reactAt and State.phase ~= "results"

	actor.sprinting = distance > nearRange
	Combat.refreshSpeed(actor)

	if now() > brain.nextStrafe then
		brain.strafe = -brain.strafe
		brain.nextStrafe = now() + 0.7 + math.random() * 0.8
	end

	local toTarget = flat(enemy.hrp.Position - actor.hrp.Position)
	local direction = toTarget.Magnitude > 0.1 and toTarget.Unit or Vector3.zAxis
	local right = Vector3.new(-direction.Z, 0, direction.X)
	local goal = actor.hrp.Position
	if distance > farRange or not visible then
		goal = enemy.hrp.Position - direction * (nearRange + 2)
	elseif distance < nearRange then
		goal = actor.hrp.Position - direction * 8 + right * brain.strafe * 6
	else
		goal = actor.hrp.Position + right * brain.strafe * 10
	end
	-- Soft separation so bots don't stack on one pad.
	for _, other in ipairs(State.actors) do
		if other ~= actor and other.alive and other.hrp then
			local delta = flat(actor.hrp.Position - other.hrp.Position)
			if delta.Magnitude > 0.05 and delta.Magnitude < 5 then
				goal = goal + delta.Unit * (5 - delta.Magnitude)
			end
		end
	end
	goal = Vector3.new(goal.X, actor.hrp.Position.Y, goal.Z)
	if visible and distance < 50 then
		brain.waypoints = nil
		brain.direct = goal
	else
		requestPath(actor, goal)
	end
end

local function follow(actor, dt)
	local brain = actor.brain
	local humanoid = actor.humanoid
	local hrp = actor.hrp
	if not humanoid or not hrp or humanoid.Health <= 0 then
		return
	end
	local goal = brain.direct
	if brain.waypoints and brain.wp <= #brain.waypoints then
		local waypoint = brain.waypoints[brain.wp]
		goal = waypoint.Position
		if waypoint.Action == Enum.PathWaypointAction.Jump then
			humanoid.Jump = true
		end
		if (flat(hrp.Position) - flat(waypoint.Position)).Magnitude < 4 then
			brain.wp = brain.wp + 1
		end
	end
	if goal then
		humanoid:MoveTo(goal)
		local rise = goal.Y - hrp.Position.Y
		if rise > 2.5 and (flat(goal) - flat(hrp.Position)).Magnitude < 8 then
			humanoid.Jump = true
		end
	end

	if brain.target and brain.target.alive and brain.target.hrp and brain.wantFire then
		local look = brain.aimAt
		local flatLook = Vector3.new(look.X, hrp.Position.Y, look.Z)
		if (flatLook - hrp.Position).Magnitude > 0.2 then
			humanoid.AutoRotate = false
			hrp.CFrame = CFrame.new(hrp.Position, flatLook)
		end
		local direction = look - (actor.head and actor.head.Position or hrp.Position)
		if direction.Magnitude > 0.1 and State.phase ~= "results" then
			Combat.tryFire(actor, actor.weapon, direction.Unit)
		end
	else
		humanoid.AutoRotate = true
	end

	local moved = (flat(hrp.Position) - flat(brain.stuckPos)).Magnitude
	if moved < 1.2 then
		brain.stuckClock = brain.stuckClock + dt
		if brain.stuckClock > 1.6 then
			humanoid.Jump = true
			brain.stuckClock = 0
			brain.waypoints = nil
			brain.direct = landmarkPosition()
			brain.stuckPos = hrp.Position
		end
	else
		brain.stuckClock = 0
		brain.stuckPos = hrp.Position
	end
end

function Bots.step(dt)
	if State.phase == "results" then
		return
	end
	for _, actor in ipairs(State.actors) do
		if not actor.player and actor.alive and actor.humanoid then
			Bots.ensureBrain(actor)
			local brain = actor.brain
			if now() >= brain.nextThink then
				brain.nextThink = now() + THINK
				think(actor)
			end
			follow(actor, dt)
		end
	end
end

return Bots
