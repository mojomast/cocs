-- Map pickups. Grants only help when the actor can use them.
-- Respawn timers match the web game's ballpark (health 12s, weapons 15s).

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local Arena = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Arena"))
local Weapons = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Weapons"))
local ColorUtil = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("ColorUtil"))
local State = require(script.Parent.State)
local Combat = require(script.Parent.Combat)

local Pickups = {}

local STYLE = {
	health = { color = "72f1b8", label = "+HP", shape = "Ball" },
	armor = { color = "75baff", label = "+ARM", shape = "Block" },
	mega = { color = "ffd166", label = "MEGA", shape = "Ball" },
	rocket = { color = "ffad61", label = "ROCKET", shape = "Block" },
	scatter = { color = "ffde87", label = "SCATTER", shape = "Block" },
	supply = { color = "8affc1", label = "AMMO", shape = "Cylinder" },
}

local function makeVisual(pickup)
	local style = STYLE[pickup.kind] or STYLE.health
	local y = Arena.floorMetres(pickup.x, pickup.z)
	local part = Instance.new("Part")
	part.Name = "Pickup_" .. pickup.kind
	part.Anchored = true
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.Material = Enum.Material.Neon
	part.Color = ColorUtil.hex(style.color)
	part.Size = Vector3.new(1.6, 1.6, 1.6)
	if style.shape == "Ball" then
		part.Shape = Enum.PartType.Ball
	elseif style.shape == "Cylinder" then
		part.Shape = Enum.PartType.Cylinder
		part.Size = Vector3.new(1.2, 1.6, 1.6)
	end
	part.CFrame = CFrame.new(pickup.x * Config.SCALE, y * Config.SCALE + 2.2, pickup.z * Config.SCALE)
	local light = Instance.new("PointLight")
	light.Color = part.Color
	light.Brightness = 1.2
	light.Range = 10
	light.Parent = part
	local billboard = Instance.new("BillboardGui")
	billboard.Size = UDim2.fromOffset(90, 24)
	billboard.StudsOffset = Vector3.new(0, 1.8, 0)
	billboard.AlwaysOnTop = false
	billboard.MaxDistance = 80
	billboard.Parent = part
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Size = UDim2.fromScale(1, 1)
	label.Font = Enum.Font.GothamBold
	label.TextSize = 13
	label.TextColor3 = part.Color
	label.TextStrokeTransparency = 0.5
	label.Text = style.label
	label.Parent = billboard
	part.Parent = State.cosmetic and State.cosmetic.Parent or workspace
	local folder = workspace:FindFirstChild("Arena")
	if folder then
		local holder = folder:FindFirstChild("Pickups")
		if not holder then
			holder = Instance.new("Folder")
			holder.Name = "Pickups"
			holder.Parent = folder
		end
		part.Parent = holder
	end
	pickup.part = part
	pickup.baseY = part.Position.Y
	pickup.hiddenUntil = 0
end

local function setVisible(pickup, visible)
	if not pickup.part then
		return
	end
	pickup.part.Transparency = visible and 0 or 1
	for _, child in ipairs(pickup.part:GetChildren()) do
		if child:IsA("PointLight") then
			child.Enabled = visible
		elseif child:IsA("BillboardGui") then
			child.Enabled = visible
		end
	end
end

local function tryGrant(actor, pickup)
	if not actor.alive or not actor.humanoid then
		return false
	end
	local kind = pickup.kind
	if kind == "health" then
		if actor.humanoid.Health >= actor.humanoid.MaxHealth - 0.5 then
			return false
		end
		actor.humanoid.Health = math.min(actor.humanoid.MaxHealth, actor.humanoid.Health + 35)
	elseif kind == "armor" then
		if actor.armor >= Config.ARMOR_CAP then
			return false
		end
		actor.armor = math.min(Config.ARMOR_CAP, actor.armor + 40)
	elseif kind == "mega" then
		if actor.humanoid.Health >= actor.humanoid.MaxHealth - 0.5 and actor.armor >= Config.ARMOR_CAP then
			return false
		end
		actor.humanoid.Health = actor.humanoid.MaxHealth
		actor.armor = math.min(Config.ARMOR_CAP, actor.armor + 40)
	elseif kind == "rocket" then
		local cap = Weapons.defs.rocket.cap
		if actor.ammo.rocket >= cap then
			return false
		end
		actor.ammo.rocket = math.min(cap, actor.ammo.rocket + Weapons.defs.rocket.ammo)
	elseif kind == "scatter" then
		local cap = Weapons.defs.scatter.cap
		if actor.ammo.scatter >= cap then
			return false
		end
		actor.ammo.scatter = math.min(cap, actor.ammo.scatter + Weapons.defs.scatter.ammo)
	elseif kind == "supply" then
		local rocketCap = Weapons.defs.rocket.cap
		local scatterCap = Weapons.defs.scatter.cap
		if actor.ammo.rocket >= rocketCap and actor.ammo.scatter >= scatterCap then
			return false
		end
		actor.ammo.rocket = math.min(rocketCap, actor.ammo.rocket + 4)
		actor.ammo.scatter = math.min(scatterCap, actor.ammo.scatter + 8)
	else
		return false
	end
	Combat.sync(actor)
	return true
end

function Pickups.build()
	State.pickups = {}
	local arena = workspace:FindFirstChild("Arena")
	if arena and arena:FindFirstChild("Pickups") then
		arena.Pickups:ClearAllChildren()
	end
	for _, spec in ipairs(Arena.pickups) do
		local pickup = {
			kind = spec.kind,
			x = spec.x,
			z = spec.z,
			respawn = spec.respawn,
			hiddenUntil = 0,
		}
		makeVisual(pickup)
		table.insert(State.pickups, pickup)
	end
end

function Pickups.nearest(actor, kinds, maxMetres)
	if not actor.hrp then
		return nil
	end
	local best = nil
	local bestDistance = maxMetres or 40
	local clock = os.clock()
	for _, pickup in ipairs(State.pickups) do
		if clock >= (pickup.hiddenUntil or 0) then
			local wanted = false
			for _, kind in ipairs(kinds) do
				if pickup.kind == kind then
					wanted = true
					break
				end
			end
			if wanted then
				local dx = actor.hrp.Position.X / Config.SCALE - pickup.x
				local dz = actor.hrp.Position.Z / Config.SCALE - pickup.z
				local distance = math.sqrt(dx * dx + dz * dz)
				if distance < bestDistance then
					bestDistance = distance
					best = pickup
				end
			end
		end
	end
	return best
end

function Pickups.step(dt)
	local clock = os.clock()
	local spin = clock * 1.6
	for _, pickup in ipairs(State.pickups) do
		local visible = clock >= (pickup.hiddenUntil or 0)
		setVisible(pickup, visible)
		if visible and pickup.part then
			local bob = math.sin(clock * 2 + pickup.x) * 0.35
			local position = Vector3.new(pickup.part.Position.X, pickup.baseY + bob, pickup.part.Position.Z)
			if pickup.part.Shape == Enum.PartType.Cylinder then
				pickup.part.CFrame = CFrame.new(position) * CFrame.Angles(0, spin, math.rad(90))
			else
				pickup.part.CFrame = CFrame.new(position) * CFrame.Angles(0, spin, 0)
			end
		end
	end
	for _, actor in ipairs(State.actors) do
		if actor.alive and actor.hrp then
			for _, pickup in ipairs(State.pickups) do
				if clock >= (pickup.hiddenUntil or 0) and pickup.part then
					local offset = actor.hrp.Position - pickup.part.Position
					if offset.Magnitude < 4.5 then
						if tryGrant(actor, pickup) then
							pickup.hiddenUntil = clock + pickup.respawn
							setVisible(pickup, false)
						end
					end
				end
			end
		end
	end
end

return Pickups
