-- Server-authoritative guns, armor, and signature harnesses.
-- Clients send an aim direction. The server fires from the actor's head,
-- applies bloom, and is the only place that changes health or the score.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local Operators = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Operators"))
local Weapons = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Weapons"))
local ColorUtil = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("ColorUtil"))
local State = require(script.Parent.State)
local Rig = require(script.Parent.Rig)

local Combat = {}

local rockets = {}

local function now()
	return os.clock()
end

local function rayParams(exclude)
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = exclude
	params.IgnoreWater = true
	return params
end

local function excludeList(actor, extra)
	local list = {}
	if actor and actor.model then
		table.insert(list, actor.model)
	end
	if State.cosmetic then
		table.insert(list, State.cosmetic)
	end
	if extra then
		table.insert(list, extra)
	end
	return list
end

local function syncActor(actor)
	local folder = actor.folder
	if folder and folder.Parent then
		folder:SetAttribute("Kills", actor.kills)
		folder:SetAttribute("Deaths", actor.deaths)
		folder:SetAttribute("Weapon", actor.weapon)
		folder:SetAttribute("Alive", actor.alive)
	end
	local player = actor.player
	if player and player.Parent then
		player:SetAttribute("Armor", actor.armor)
		player:SetAttribute("Weapon", actor.weapon)
		player:SetAttribute("AmmoRocket", actor.ammo.rocket)
		player:SetAttribute("AmmoScatter", actor.ammo.scatter)
		player:SetAttribute("Protected", now() < (actor.protectedUntil or 0))
		local ready = actor.abilityReadyAt or 0
		local remaining = ready - now()
		if remaining < 0 then
			remaining = 0
		end
		player:SetAttribute("AbilityRemaining", remaining)
		local harness = Operators.harnessOf(actor.operator)
		player:SetAttribute("AbilityName", harness and harness.power or "")
		player:SetAttribute("AbilityCooldown", harness and harness.cooldown or 0)
	end
	if actor.model and actor.humanoid then
		local maxHealth = actor.humanoid.MaxHealth
		local fraction = 0
		if maxHealth > 0 then
			fraction = actor.humanoid.Health / maxHealth
		end
		actor.model:SetAttribute("Armor", actor.armor)
		Rig.setHealthBar(actor.model, fraction)
	end
end

function Combat.sync(actor)
	syncActor(actor)
end

function Combat.expectedSpeed(actor)
	local speed = actor.operator.speed * Config.SCALE
	if now() < (actor.rushUntil or 0) then
		speed = speed * 1.6
	end
	if now() < (actor.slowUntil or 0) then
		speed = speed * 0.5
	end
	if actor.sprinting then
		speed = speed * Config.SPRINT
	end
	if State.phase == "results" then
		speed = 0
	end
	return speed
end

function Combat.refreshSpeed(actor)
	if not actor.humanoid or not actor.humanoid.Parent then
		return
	end
	local speed = Combat.expectedSpeed(actor)
	actor.humanoid.WalkSpeed = speed
	if actor.model then
		actor.model:SetAttribute("MoveSpeed", speed)
	end
	if actor.player then
		actor.player:SetAttribute("MoveSpeed", speed)
	end
end

local function clearProtection(actor)
	actor.protectedUntil = 0
	if actor.forceField and actor.forceField.Parent then
		actor.forceField:Destroy()
	end
	actor.forceField = nil
end

local function deflect(direction, spread)
	if spread <= 0 then
		return direction
	end
	local upRef = Vector3.yAxis
	if math.abs(direction:Dot(upRef)) > 0.98 then
		upRef = Vector3.xAxis
	end
	local right = direction:Cross(upRef)
	if right.Magnitude < 1e-4 then
		return direction
	end
	right = right.Unit
	local up = right:Cross(direction).Unit
	local a = (math.random() - 0.5) * spread
	local b = (math.random() - 0.5) * spread
	local bent = direction + right * a + up * b
	if bent.Magnitude < 1e-4 then
		return direction
	end
	return bent.Unit
end

local function fx(payload, player)
	local remote = State.remotes and State.remotes.CombatFx
	if not remote then
		return
	end
	if player then
		remote:FireClient(player, payload)
	else
		remote:FireAllClients(payload)
	end
end

local function impulse(actor, velocity)
	if not actor.hrp or not actor.hrp.Parent then
		return
	end
	if actor.player and actor.player.Parent and State.remotes then
		State.remotes.Impulse:FireClient(actor.player, velocity)
	end
	-- Bots are server-owned. Players get the remote; also poke the server copy
	-- so a listen-server still moves if the client impulse is late.
	if not actor.player then
		actor.hrp.AssemblyLinearVelocity = actor.hrp.AssemblyLinearVelocity + velocity
	end
end

local function actorFromPart(instance)
	if not instance then
		return nil
	end
	local model = instance:FindFirstAncestorOfClass("Model")
	if not model then
		return nil
	end
	return State.byModel[model]
end

function Combat.damage(actor, amount, attacker, position, cause)
	if not actor or not actor.alive or not actor.humanoid or actor.humanoid.Health <= 0 then
		return 0
	end
	if State.phase ~= "live" and State.phase ~= "warmup" then
		return 0
	end
	if now() < (actor.protectedUntil or 0) then
		return 0
	end
	if amount <= 0 or amount ~= amount then
		return 0
	end
	if now() < (actor.guardrailUntil or 0) then
		amount = amount * 0.5
	end
	local absorbed = math.min(actor.armor, amount * Config.ARMOR_ABSORB)
	actor.armor = actor.armor - absorbed
	local healthDamage = amount - absorbed
	if attacker and attacker ~= actor then
		actor.lastAttacker = attacker
		actor.lastHitTime = now()
	elseif attacker == actor then
		actor.lastAttacker = actor
		actor.lastHitTime = now()
	end
	actor.deathCause = cause or "gun"
	actor.humanoid.Health = actor.humanoid.Health - healthDamage
	syncActor(actor)
	if actor.player and healthDamage > 0 then
		fx({ kind = "hurt", amount = healthDamage }, actor.player)
	end
	if position and healthDamage > 0.5 then
		fx({
			kind = "float",
			position = position,
			text = tostring(math.floor(healthDamage + 0.5)),
			color = Color3.fromRGB(255, 220, 160),
		})
	end
	return healthDamage
end

local function blastClear(fromPosition, targetActor)
	if not targetActor.hrp then
		return false
	end
	local target = targetActor.hrp.Position
	local delta = target - fromPosition
	if delta.Magnitude < 0.2 then
		return true
	end
	local hit = workspace:Raycast(fromPosition, delta, rayParams(excludeList(nil, State.cosmetic)))
	if not hit then
		return true
	end
	local hitActor = actorFromPart(hit.Instance)
	return hitActor == targetActor
end

local function explode(rocket, position, directActor)
	local weapon = rocket.weapon
	local radius = weapon.radius
	local color = ColorUtil.hex(weapon.color)
	fx({
		kind = "boom",
		position = position,
		radius = radius * Config.SCALE,
		color = color,
	})
	if rocket.part then
		rocket.part:Destroy()
	end
	local damaged = {}
	if directActor and directActor.alive then
		local splash = (weapon.splash or 0) * Weapons.splashFraction(0, radius)
		Combat.damage(directActor, weapon.damage + splash, rocket.attacker, position, "rocket")
		damaged[directActor] = true
	end
	for _, actor in ipairs(State.actors) do
		if actor.alive and actor.hrp and not damaged[actor] then
			local distance = (actor.hrp.Position - position).Magnitude / Config.SCALE
			if distance <= radius and blastClear(position, actor) then
				local amount = (weapon.splash or 0) * Weapons.splashFraction(distance, radius)
				Combat.damage(actor, amount, rocket.attacker, position, "rocket")
				local away = actor.hrp.Position - position
				if away.Magnitude < 0.1 then
					away = Vector3.yAxis
				end
				local push = away.Unit * (18 * (1 - distance / radius)) + Vector3.new(0, 10, 0)
				impulse(actor, push)
			end
		end
	end
end

local function speedFrac(actor)
	if not actor.hrp then
		return 0
	end
	local velocity = actor.hrp.AssemblyLinearVelocity
	local horizontal = Vector3.new(velocity.X, 0, velocity.Z).Magnitude
	local base = actor.operator.speed * Config.SCALE
	if base <= 0 then
		return 0
	end
	return math.clamp(horizontal / base, 0, 1)
end

local function fireHitscan(actor, weapon, direction)
	local origin = actor.head and actor.head.Position or actor.hrp.Position
	local range = weapon.range * Config.SCALE
	local color = ColorUtil.hex(weapon.color)
	local pellets = weapon.pellets or 1
	local spread = Weapons.effectiveSpread(weapon, actor.spread, speedFrac(actor), actor.sprinting)
	for _ = 1, pellets do
		local shotDir = deflect(direction, spread)
		local result = workspace:Raycast(origin, shotDir * range, rayParams(excludeList(actor)))
		local finish = origin + shotDir * range
		if result then
			finish = result.Position
			local victim = actorFromPart(result.Instance)
			if victim and victim ~= actor and victim.alive then
				local distance = (finish - origin).Magnitude / Config.SCALE
				local amount = weapon.damage * Weapons.falloff(weapon, distance)
				local before = victim.humanoid.Health
				Combat.damage(victim, amount, actor, finish, weapon.id)
				if actor.player then
					fx({
						kind = "marker",
						killed = before > 0 and victim.humanoid.Health <= 0,
					}, actor.player)
				end
			end
		end
		fx({
			kind = "tracer",
			shooter = actor.id,
			origin = origin,
			finish = finish,
			color = color,
			width = pellets > 1 and 0.08 or 0.12,
		})
	end
	actor.spread = Weapons.addSpread(weapon, actor.spread)
end

local function fireRocket(actor, weapon, direction)
	local eye = actor.head and actor.head.Position or actor.hrp.Position
	local probe = workspace:Raycast(eye, direction * 3, rayParams(excludeList(actor)))
	if probe then
		explode({
			weapon = weapon,
			attacker = actor,
			part = nil,
		}, probe.Position, actorFromPart(probe.Instance))
		return
	end
	local origin = eye + direction * 2.4
	local speed = weapon.speed * Config.SCALE
	local part = Instance.new("Part")
	part.Name = "Rocket"
	part.Shape = Enum.PartType.Ball
	part.Size = Vector3.new(1.3, 1.3, 1.3)
	part.Material = Enum.Material.Neon
	part.Color = ColorUtil.hex(weapon.color)
	part.Anchored = true
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.CFrame = CFrame.new(origin)
	local light = Instance.new("PointLight")
	light.Color = part.Color
	light.Brightness = 2
	light.Range = 14
	light.Parent = part
	part.Parent = workspace
	table.insert(rockets, {
		part = part,
		pos = origin,
		velocity = direction * speed,
		traveled = 0,
		range = weapon.range * Config.SCALE,
		weapon = weapon,
		attacker = actor,
	})
end

function Combat.tryFire(actor, weaponId, direction)
	if State.phase ~= "live" and State.phase ~= "warmup" then
		return false
	end
	if not actor or not actor.alive or not actor.hrp then
		return false
	end
	if typeof(direction) ~= "Vector3" then
		return false
	end
	if direction.Magnitude < 0.2 or direction.Magnitude > 4 or direction.Magnitude ~= direction.Magnitude then
		return false
	end
	direction = direction.Unit
	local weapon = Weapons.get(weaponId)
	if not weapon or actor.weapon ~= weaponId then
		return false
	end
	if now() < (actor.nextFire or 0) then
		return false
	end
	if weapon.ammo ~= math.huge then
		local ammo = actor.ammo[weaponId] or 0
		if ammo <= 0 then
			return false
		end
		actor.ammo[weaponId] = ammo - 1
	end
	actor.nextFire = now() + weapon.interval
	clearProtection(actor)
	if weapon.kind == "projectile" then
		fireRocket(actor, weapon, direction)
	else
		fireHitscan(actor, weapon, direction)
	end
	syncActor(actor)
	return true
end

function Combat.tryAbility(actor)
	if State.phase ~= "live" and State.phase ~= "warmup" then
		return false
	end
	if not actor or not actor.alive or not actor.humanoid then
		return false
	end
	if now() < (actor.abilityReadyAt or 0) then
		return false
	end
	local harness = Operators.harnessOf(actor.operator)
	if not harness then
		return false
	end
	actor.abilityReadyAt = now() + harness.cooldown
	clearProtection(actor)
	local origin = actor.hrp.Position
	if harness.id == "codex" then
		actor.humanoid.Health = math.min(actor.humanoid.MaxHealth, actor.humanoid.Health + harness.heal)
		fx({ kind = "pulse", position = origin, radius = 6, color = Color3.fromRGB(120, 255, 190) })
	elseif harness.id == "guardrail" then
		actor.guardrailUntil = now() + harness.duration
		local highlight = Instance.new("Highlight")
		highlight.Name = "Guardrail"
		highlight.FillColor = Color3.fromRGB(242, 157, 113)
		highlight.OutlineColor = Color3.fromRGB(255, 220, 190)
		highlight.FillTransparency = 0.55
		highlight.Parent = actor.model
		actor.guardHighlight = highlight
		fx({ kind = "pulse", position = origin, radius = 5, color = Color3.fromRGB(242, 157, 113) })
	elseif harness.id == "hermes" then
		actor.rushUntil = now() + harness.duration
		Combat.refreshSpeed(actor)
		fx({ kind = "pulse", position = origin, radius = 5, color = Color3.fromRGB(114, 241, 184) })
	elseif harness.id == "openclaw" or harness.id == "contextjam" then
		local radius = harness.radius
		fx({
			kind = "pulse",
			position = origin,
			radius = radius * Config.SCALE,
			color = harness.id == "openclaw" and Color3.fromRGB(255, 150, 90) or Color3.fromRGB(180, 140, 255),
		})
		for _, other in ipairs(State.actors) do
			if other ~= actor and other.alive and other.hrp then
				local distance = (other.hrp.Position - origin).Magnitude / Config.SCALE
				if distance <= radius and blastClear(origin, other) then
					if harness.id == "openclaw" then
						Combat.damage(other, harness.damage, actor, other.hrp.Position, "claw")
						local away = other.hrp.Position - origin
						local flat = Vector3.new(away.X, 0, away.Z)
						if flat.Magnitude < 0.1 then
							flat = Vector3.zAxis
						end
						impulse(other, flat.Unit * (harness.knock * Config.SCALE * 0.55) + Vector3.new(0, harness.lift * Config.SCALE, 0))
					else
						other.slowUntil = math.max(other.slowUntil or 0, now() + harness.duration)
						Combat.refreshSpeed(other)
					end
				end
			end
		end
	end
	syncActor(actor)
	return true
end

function Combat.setSprint(actor, sprinting)
	if not actor or not actor.alive then
		return
	end
	actor.sprinting = sprinting and true or false
	Combat.refreshSpeed(actor)
end

function Combat.switchWeapon(actor, weaponId)
	if not actor or not actor.alive then
		return
	end
	if not Weapons.get(weaponId) then
		return
	end
	actor.weapon = weaponId
	actor.spread = 0
	syncActor(actor)
end

function Combat.step(dt)
	for _, actor in ipairs(State.actors) do
		if actor.alive then
			local weapon = Weapons.get(actor.weapon)
			if weapon then
				actor.spread = Weapons.recoverSpread(weapon, actor.spread or 0, dt)
			end
			local rushing = now() < (actor.rushUntil or 0)
			local slowed = now() < (actor.slowUntil or 0)
			local guarded = now() < (actor.guardrailUntil or 0)
			if rushing ~= actor._rushing or slowed ~= actor._slowed then
				actor._rushing = rushing
				actor._slowed = slowed
				Combat.refreshSpeed(actor)
			end
			if not guarded and actor.guardHighlight and actor.guardHighlight.Parent then
				actor.guardHighlight:Destroy()
				actor.guardHighlight = nil
			end
			if actor.humanoid and math.abs(actor.humanoid.WalkSpeed - Combat.expectedSpeed(actor)) > 1.5 then
				Combat.refreshSpeed(actor)
			end
		end
	end

	-- Copy first: a killing blow can defer a clear of this list mid-explosion.
	local flying = table.clone(rockets)
	table.clear(rockets)
	for _, rocket in ipairs(flying) do
		if rocket.part and rocket.part.Parent == nil and rocket.traveled > 0 then
			continue
		end
		local step = rocket.velocity * dt
		local hit = workspace:Raycast(rocket.pos, step, rayParams(excludeList(rocket.attacker, rocket.part)))
		if hit then
			local direct = actorFromPart(hit.Instance)
			explode(rocket, hit.Position, direct)
		else
			rocket.pos = rocket.pos + step
			rocket.traveled = rocket.traveled + step.Magnitude
			if rocket.part and rocket.part.Parent then
				rocket.part.CFrame = CFrame.new(rocket.pos)
			end
			if rocket.traveled >= rocket.range then
				explode(rocket, rocket.pos, nil)
			elseif rocket.part and rocket.part.Parent then
				table.insert(rockets, rocket)
			end
		end
	end
end

function Combat.clearProjectiles()
	for _, rocket in ipairs(rockets) do
		if rocket.part then
			rocket.part:Destroy()
		end
	end
	table.clear(rockets)
end

return Combat
