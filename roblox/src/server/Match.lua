-- Free-for-all loop. Warmup until the first human deploys, then 15 frags or 5 minutes.
-- Kills, deaths, respawns, and the clock live here. Combat never edits the score itself.

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local Operators = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Operators"))
local Arena = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Arena"))
local State = require(script.Parent.State)
local Rig = require(script.Parent.Rig)
local Combat = require(script.Parent.Combat)
local Bots = require(script.Parent.Bots)
local Pickups = require(script.Parent.Pickups)

local Match = {}

local function fx(text)
	if State.remotes then
		State.remotes.CombatFx:FireAllClients({ kind = "feed", text = text })
	end
end

local function setPhase(phase, status)
	State.phase = phase
	if State.matchFolder then
		State.matchFolder:SetAttribute("Phase", phase)
		State.matchFolder:SetAttribute("TimeLeft", math.max(0, State.timeLeft))
		State.matchFolder:SetAttribute("FragLimit", Config.FRAG_LIMIT)
		if status then
			State.matchFolder:SetAttribute("Status", status)
		end
	end
end

local function occupiedByOthers(skip)
	local list = {}
	for _, actor in ipairs(State.actors) do
		if actor ~= skip and actor.alive and actor.hrp then
			table.insert(list, {
				x = actor.hrp.Position.X / Config.SCALE,
				z = actor.hrp.Position.Z / Config.SCALE,
			})
		end
	end
	return list
end

local function spawnCFrame(actor)
	local spot = Arena.pickSpawn(occupiedByOthers(actor))
	local floorY = Arena.floorMetres(spot.x, spot.z)
	local position = Vector3.new(
		spot.x * Config.SCALE,
		floorY * Config.SCALE + Config.HIP_OFFSET + 0.25,
		spot.z * Config.SCALE
	)
	local lookTarget = Vector3.new(0, position.Y, 0)
	if (lookTarget - position).Magnitude < 1 then
		lookTarget = position + Vector3.new(0, 0, -1)
	end
	return CFrame.lookAt(position, lookTarget)
end

local function displayName(actor)
	if actor.player then
		return actor.player.DisplayName
	end
	return actor.operator.name .. " BOT"
end

local function ensureFolder(actor)
	if actor.folder and actor.folder.Parent then
		return
	end
	local folder = Instance.new("Folder")
	folder.Name = "A" .. tostring(actor.id)
	folder.Parent = State.roster
	actor.folder = folder
end

local function syncRoster(actor)
	ensureFolder(actor)
	local folder = actor.folder
	folder:SetAttribute("Name", displayName(actor))
	folder:SetAttribute("Operator", actor.operator.id)
	folder:SetAttribute("Color", actor.operator.color)
	folder:SetAttribute("Bot", actor.player == nil)
	folder:SetAttribute("Kills", actor.kills)
	folder:SetAttribute("Deaths", actor.deaths)
	folder:SetAttribute("Weapon", actor.weapon)
	folder:SetAttribute("Alive", actor.alive)
	Combat.sync(actor)
end

local function removeFromList(actor)
	for index, other in ipairs(State.actors) do
		if other == actor then
			table.remove(State.actors, index)
			break
		end
	end
	State.byId[actor.id] = nil
	if actor.model then
		State.byModel[actor.model] = nil
	end
	if actor.folder then
		actor.folder:Destroy()
		actor.folder = nil
	end
end

local function onDied(actor)
	if actor.deadHandled then
		return
	end
	actor.deadHandled = true
	actor.alive = false
	actor.sprinting = false
	if actor.model then
		for _, item in ipairs(actor.model:GetDescendants()) do
			if item:IsA("BasePart") and item.Name ~= "HumanoidRootPart" then
				item.Material = Enum.Material.Neon
			end
		end
	end

	if State.phase == "live" then
		local killer = actor.lastAttacker
		local fresh = killer and (os.clock() - (actor.lastHitTime or 0)) <= Config.ASSIST_WINDOW
		if killer and killer ~= actor and fresh then
			killer.kills = killer.kills + 1
			actor.deaths = actor.deaths + 1
			syncRoster(killer)
			fx(string.upper(displayName(killer)) .. "  →  " .. string.upper(displayName(actor)))
		else
			actor.kills = actor.kills - 1
			actor.deaths = actor.deaths + 1
			fx(string.upper(displayName(actor)) .. "  wiped")
		end
		syncRoster(actor)
	else
		syncRoster(actor)
	end

	if State.phase == "results" then
		return
	end
	local generation = actor.generation
	task.delay(Config.RESPAWN, function()
		if actor.generation ~= generation then
			return
		end
		if not State.byId[actor.id] then
			return
		end
		if State.phase == "results" then
			return
		end
		if actor.player and not actor.player:GetAttribute("InMatch") then
			return
		end
		Match.spawnActor(actor)
	end)
end

function Match.spawnActor(actor)
	-- Bump generation before destroy so the old Humanoid.Died cannot score a fake death.
	actor.generation = (actor.generation or 0) + 1
	if actor.model then
		State.byModel[actor.model] = nil
		local old = actor.model
		actor.model = nil
		old:Destroy()
	end
	actor.deadHandled = false
	actor.alive = true
	actor.armor = actor.operator.armor
	actor.weapon = "pulse"
	actor.ammo = { rocket = Config.STARTER_ROCKET, scatter = Config.STARTER_SCATTER }
	actor.spread = 0
	actor.nextFire = 0
	actor.sprinting = false
	actor.protectedUntil = os.clock() + Config.PROTECTION
	actor.rushUntil = 0
	actor.slowUntil = 0
	actor.guardrailUntil = 0
	actor.abilityReadyAt = 0
	actor.lastAttacker = nil
	actor.lastHitTime = 0
	actor._rushing = false
	actor._slowed = false
	actor.guardHighlight = nil
	actor.phaseAnim = 0

	local name = actor.player and actor.player.Name or (actor.operator.name .. " Bot")
	local model = Rig.build(name, actor.operator, actor.player)
	actor.model = model
	actor.humanoid = model:FindFirstChildOfClass("Humanoid")
	actor.hrp = model:FindFirstChild("HumanoidRootPart")
	actor.head = model:FindFirstChild("Head")
	if not actor.humanoid or not actor.hrp then
		error("Rig is missing Humanoid or HumanoidRootPart")
	end
	model:SetAttribute("ActorId", actor.id)
	State.byModel[model] = actor

	local generation = actor.generation
	actor.humanoid.Died:Connect(function()
		if actor.generation ~= generation then
			return
		end
		onDied(actor)
	end)
	actor.humanoid.HealthChanged:Connect(function()
		if actor.model and actor.humanoid and actor.humanoid.MaxHealth > 0 then
			Rig.setHealthBar(actor.model, actor.humanoid.Health / actor.humanoid.MaxHealth)
		end
	end)

	model:SetAttribute("COCSRig", true)
	local placed = spawnCFrame(actor)
	-- Parent before assigning Character. Assigning first lets the engine
	-- spawn a default avatar and our CharacterAdded hook deletes the rig.
	model.Parent = workspace
	model:PivotTo(placed)
	if actor.player then
		actor.player.Character = model
		model:PivotTo(placed)
	end
	local function claim(owner)
		if not actor.hrp or actor.hrp.Parent == nil then
			return
		end
		actor.hrp:SetNetworkOwner(owner)
	end
	if actor.player then
		local owned, ownErr = pcall(claim, actor.player)
		if not owned then
			warn("[COCS] Network owner deferred:", ownErr)
		end
	else
		pcall(claim, nil)
	end

	local shield = Instance.new("ForceField")
	shield.Parent = model
	actor.forceField = shield
	task.delay(Config.PROTECTION, function()
		if actor.forceField == shield and shield.Parent then
			shield:Destroy()
		end
	end)

	actor.brain = nil
	actor.animBase = nil
	Bots.ensureBrain(actor)
	Combat.refreshSpeed(actor)
	task.defer(function()
		if not actor.hrp or not actor.hrp.Parent then
			return
		end
		-- The engine sometimes moves a new character onto a leftover pad
		-- one frame after Character is assigned.
		if actor.model and actor.model.Parent then
			actor.model:PivotTo(placed)
		end
		local ok, err = pcall(claim, actor.player and actor.player.Parent and actor.player or nil)
		if not ok then
			warn("[COCS] Network owner failed:", err)
		end
	end)
	syncRoster(actor)
	if actor.player then
		print("[COCS] Spawned", actor.player.Name, "as", actor.operator.id)
	end
end

local function makeActor(operator, player)
	local actor = {
		id = State.nextId,
		player = player,
		operator = operator,
		kills = 0,
		deaths = 0,
		alive = false,
		ammo = { rocket = Config.STARTER_ROCKET, scatter = Config.STARTER_SCATTER },
		weapon = "pulse",
		armor = operator.armor,
		generation = 0,
	}
	State.nextId = State.nextId + 1
	State.byId[actor.id] = actor
	table.insert(State.actors, actor)
	if player then
		player:SetAttribute("InMatch", true)
		player:SetAttribute("Operator", operator.id)
		local harness = Operators.harnessOf(operator)
		player:SetAttribute("AbilityName", harness.power)
	end
	return actor
end

local function usedOperators()
	local used = {}
	for _, actor in ipairs(State.actors) do
		used[actor.operator.id] = (used[actor.operator.id] or 0) + 1
	end
	return used
end

local function pickBotOperator()
	local used = usedOperators()
	local best = nil
	local bestCount = math.huge
	local pool = {}
	for _, operator in ipairs(Operators.all()) do
		local count = used[operator.id] or 0
		if count < bestCount then
			bestCount = count
			pool = { operator }
			best = operator
		elseif count == bestCount then
			table.insert(pool, operator)
		end
	end
	if #pool == 0 then
		return best or Operators.get("grok")
	end
	return pool[math.random(1, #pool)]
end

local function desiredBots()
	local humans = State.humanCount()
	if humans <= 0 then
		return Config.ROSTER - 1
	end
	return math.max(0, Config.ROSTER - humans)
end

local function removeActor(actor)
	actor.generation = (actor.generation or 0) + 1
	if actor.player then
		actor.player:SetAttribute("InMatch", false)
	end
	if actor.model then
		State.byModel[actor.model] = nil
		actor.model:Destroy()
		actor.model = nil
	end
	removeFromList(actor)
end

function Match.maintainBots()
	local want = desiredBots()
	while State.botCount() > want do
		local victim = nil
		for index = #State.actors, 1, -1 do
			if not State.actors[index].player then
				victim = State.actors[index]
				break
			end
		end
		if not victim then
			break
		end
		removeActor(victim)
	end
	while State.botCount() < want do
		local operator = pickBotOperator()
		local actor = makeActor(operator, nil)
		Match.spawnActor(actor)
	end
end

local function resetScores()
	for _, actor in ipairs(State.actors) do
		actor.kills = 0
		actor.deaths = 0
		syncRoster(actor)
	end
end

local function standDown()
	for _, actor in ipairs(State.actors) do
		actor.sprinting = false
		Combat.refreshSpeed(actor)
	end
end

function Match.winnerInfo()
	local best = -math.huge
	local leaders = {}
	for _, actor in ipairs(State.actors) do
		if actor.kills > best then
			best = actor.kills
			leaders = { actor }
		elseif actor.kills == best then
			table.insert(leaders, actor)
		end
	end
	return leaders, best
end

function Match.checkWinner()
	if State.phase ~= "live" then
		return
	end
	local reached = false
	for _, actor in ipairs(State.actors) do
		if actor.kills >= Config.FRAG_LIMIT then
			reached = true
			break
		end
	end
	if reached or State.timeLeft <= 0 then
		Match.finish(reached and "frags" or "time")
	end
end

function Match.finish(reason)
	if State.phase == "results" then
		return
	end
	local leaders, best = Match.winnerInfo()
	local tie = #leaders ~= 1
	local winnerName = tie and "TIE" or displayName(leaders[1])
	State.timeLeft = math.max(0, State.timeLeft)
	if State.matchFolder then
		State.matchFolder:SetAttribute("Winner", winnerName)
		State.matchFolder:SetAttribute("Tie", tie)
		State.matchFolder:SetAttribute("WinFrags", best)
		State.matchFolder:SetAttribute("EndReason", reason)
	end
	local status = tie and "Tie. Nobody gets the last word." or (string.upper(winnerName) .. " takes the pit.")
	setPhase("results", status)
	State.intermissionLeft = Config.INTERMISSION
	standDown()
	-- Defer so a rocket that just scored the last kill can finish its own loop.
	task.defer(function()
		Combat.clearProjectiles()
	end)
	fx(status)
end

function Match.beginLive()
	State.timeLeft = Config.TIME_LIMIT
	State.intermissionLeft = 0
	if State.matchFolder then
		State.matchFolder:SetAttribute("Winner", "")
		State.matchFolder:SetAttribute("Tie", false)
	end
	resetScores()
	setPhase("live", "Fight. First to " .. tostring(Config.FRAG_LIMIT) .. " or five minutes.")
	for _, actor in ipairs(State.actors) do
		if not actor.player then
			Match.spawnActor(actor)
		end
	end
	Combat.clearProjectiles()
end

function Match.enterWarmup()
	State.timeLeft = Config.TIME_LIMIT
	State.intermissionLeft = 0
	if State.matchFolder then
		State.matchFolder:SetAttribute("Winner", "")
		State.matchFolder:SetAttribute("Tie", false)
	end
	resetScores()
	setPhase("warmup", "Pick an operator. Bots are already in the pit.")
	Match.maintainBots()
end

local function deploy(player, operator)
	if player:GetAttribute("InMatch") then
		warn("[COCS] Deploy ignored: already in match")
		return
	end
	local existing = State.actorForPlayer(player)
	if existing then
		removeActor(existing)
	end
	-- Results used to return before InMatch was set, so the select screen
	-- stayed up and a second click did nothing. Spawn them anyway; the
	-- intermission respawn keeps anyone already flagged in the match.
	local wasWarmup = State.phase ~= "live"
	if wasWarmup and State.phase ~= "results" then
		Match.maintainBots()
		Match.beginLive()
	end
	local actor = makeActor(operator, player)
	local spawned, err = pcall(Match.spawnActor, actor)
	if not spawned then
		warn("[COCS] Spawn failed:", err)
		removeActor(actor)
		return
	end
	Match.maintainBots()
end

local function changeOperator(player)
	local actor = State.actorForPlayer(player)
	if actor then
		removeActor(actor)
	else
		player:SetAttribute("InMatch", false)
	end
	if State.humanCount() <= 0 then
		Match.enterWarmup()
	else
		Match.maintainBots()
	end
end

local function animate(actor, dt)
	if not actor.alive or not actor.model or not actor.hrp then
		return
	end
	local speed = actor.hrp.AssemblyLinearVelocity.Magnitude
	actor.phaseAnim = (actor.phaseAnim or 0) + dt * math.clamp(speed, 0, 40) * 0.55
	local amount = math.sin(actor.phaseAnim) * math.clamp(speed / 16, 0, 1) * 0.65
	for _, joint in ipairs(actor.model:GetDescendants()) do
		if joint:IsA("Weld") then
			local swing = joint:GetAttribute("Swing")
			if swing then
				if not actor.animBase then
					actor.animBase = {}
				end
				if not actor.animBase[joint] then
					actor.animBase[joint] = joint.C0
				end
				local base = actor.animBase[joint]
				if not joint.Part1 then
					continue
				end
				local sign = string.find(joint.Part1.Name, "Left", 1, true) and 1 or -1
				if swing == "arm" then
					sign = -sign
				end
				joint.C0 = base * CFrame.Angles(amount * sign, 0, 0)
			end
		end
	end
end

local function boundsCheck(actor)
	if not actor.alive or not actor.hrp then
		return
	end
	local position = actor.hrp.Position
	local x = position.X / Config.SCALE
	local y = position.Y / Config.SCALE
	local z = position.Z / Config.SCALE
	if Arena.outOfBounds(x, y, z) then
		actor.deathCause = "void"
		if actor.humanoid then
			actor.humanoid.Health = 0
		end
	end
end

local syncClock = 0

function Match.step(dt)
	if dt > 0.1 then
		dt = 0.1
	end
	if State.phase == "live" then
		State.timeLeft = State.timeLeft - dt
		if State.timeLeft <= 0 then
			State.timeLeft = 0
			Match.finish("time")
		end
	elseif State.phase == "results" then
		State.intermissionLeft = (State.intermissionLeft or 0) - dt
		if State.intermissionLeft <= 0 then
			if State.humanCount() > 0 then
				Match.beginLive()
				for _, actor in ipairs(State.actors) do
					if actor.player and actor.player:GetAttribute("InMatch") then
						Match.spawnActor(actor)
					end
				end
			else
				Match.enterWarmup()
			end
		end
	end

	syncClock = syncClock + dt
	if syncClock >= 0.25 and State.matchFolder then
		syncClock = 0
		State.matchFolder:SetAttribute("TimeLeft", math.max(0, State.timeLeft))
		State.matchFolder:SetAttribute("Intermission", State.intermissionLeft or 0)
		for _, actor in ipairs(State.actors) do
			Combat.sync(actor)
		end
	end

	for _, actor in ipairs(State.actors) do
		boundsCheck(actor)
		animate(actor, dt)
	end
	Combat.step(dt)
	Pickups.step(dt)
	Bots.step(dt)
	if State.phase == "live" then
		Match.checkWinner()
	end
end

local function hookPlayer(player)
	player:SetAttribute("InMatch", false)
	-- Drop a default avatar if the place spawned one before this script.
	-- COCSRig marks a body we built; that one stays.
	player.CharacterAdded:Connect(function(character)
		if character:GetAttribute("COCSRig") or player:GetAttribute("InMatch") then
			return
		end
		task.defer(function()
			if character.Parent and player.Parent and not player:GetAttribute("InMatch") and not character:GetAttribute("COCSRig") then
				character:Destroy()
			end
		end)
	end)
	if player.Character then
		player.Character:Destroy()
	end
end

function Match.start()
	Players.CharacterAutoLoads = false
	-- The default avatar loader replaces a procedural rig when Character is
	-- assigned, which leaves a dead or missing body after deploy.
	pcall(function()
		game:GetService("StarterPlayer").LoadCharacterAppearance = false
	end)
	workspace.Gravity = Config.GRAVITY
	-- FallenPartsDestroyHeight is not writable from a Script (PluginOrOpenCloud).
	-- default.project.json sets it on Workspace. Do not assign it here or Match.start aborts
	-- before SelectOperator is connected.

	local function strip(child)
		if child:IsA("SpawnLocation") or child.Name == "Baseplate" then
			child:Destroy()
		end
	end
	for _, child in ipairs(workspace:GetChildren()) do
		strip(child)
	end
	workspace.ChildAdded:Connect(strip)

	State.remotes.SelectOperator.OnServerEvent:Connect(function(player, operatorId)
		print("[COCS] SelectOperator", player.Name, operatorId)
		if typeof(operatorId) ~= "string" then
			warn("[COCS] Deploy ignored: operator id was", typeof(operatorId))
			return
		end
		local operator = Operators.get(operatorId)
		if not operator then
			warn("[COCS] Deploy ignored: unknown operator", operatorId)
			return
		end
		local ok, err = pcall(deploy, player, operator)
		if not ok then
			warn("[COCS] Deploy failed:", err)
		end
	end)
	State.remotes.ChangeOperator.OnServerEvent:Connect(function(player)
		changeOperator(player)
	end)
	State.remotes.FireWeapon.OnServerEvent:Connect(function(player, weaponId, direction)
		local actor = State.actorForPlayer(player)
		if not actor or typeof(weaponId) ~= "string" then
			return
		end
		Combat.tryFire(actor, weaponId, direction)
	end)
	State.remotes.SwitchWeapon.OnServerEvent:Connect(function(player, weaponId)
		local actor = State.actorForPlayer(player)
		if actor and typeof(weaponId) == "string" then
			Combat.switchWeapon(actor, weaponId)
		end
	end)
	State.remotes.SetSprint.OnServerEvent:Connect(function(player, sprinting)
		local actor = State.actorForPlayer(player)
		if actor and typeof(sprinting) == "boolean" then
			Combat.setSprint(actor, sprinting)
		end
	end)
	State.remotes.UseAbility.OnServerEvent:Connect(function(player)
		local actor = State.actorForPlayer(player)
		if actor then
			Combat.tryAbility(actor)
		end
	end)

	Players.PlayerAdded:Connect(hookPlayer)
	for _, player in ipairs(Players:GetPlayers()) do
		hookPlayer(player)
	end
	Players.PlayerRemoving:Connect(function(player)
		local actor = State.actorForPlayer(player)
		if actor then
			removeActor(actor)
		end
		if State.humanCount() <= 0 and State.phase == "live" then
			Match.enterWarmup()
		else
			Match.maintainBots()
		end
	end)

	setPhase("warmup", "Pick an operator. Bots are already in the pit.")
	Match.maintainBots()

	RunService.Heartbeat:Connect(function(dt)
		Match.step(dt)
	end)

	print("[COCS] The Exchange is up. Play Solo, pick an operator, fight the bots.")
end

return Match
