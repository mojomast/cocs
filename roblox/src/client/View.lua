-- First-person camera kick, a block viewmodel, tracers, and a little air steer.
-- The server still decides whether the shot hit. Recoil here is presentation.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Weapons = require(Shared:WaitForChild("Weapons"))
local ColorUtil = require(Shared:WaitForChild("ColorUtil"))

local View = {}

local KICK_SCALE = 3.4

local function weaponModel(weaponId)
	local weapon = Weapons.get(weaponId) or Weapons.get("pulse")
	local color = ColorUtil.hex(weapon.color)
	local model = Instance.new("Model")
	model.Name = weapon.short
	local function bar(name, size, cframe, partColor, material)
		local part = Instance.new("Part")
		part.Name = name
		part.Size = size
		part.Color = partColor or Color3.fromRGB(28, 32, 36)
		part.Material = material or Enum.Material.Metal
		part.Anchored = true
		part.CanCollide = false
		part.CanQuery = false
		part.CanTouch = false
		part.CFrame = cframe
		part.Parent = model
		return part
	end
	if weaponId == "rocket" then
		bar("Body", Vector3.new(0.35, 0.4, 1.5), CFrame.new(0.55, -0.45, -1.5))
		bar("Tube", Vector3.new(0.28, 0.28, 1.1), CFrame.new(0.55, -0.28, -2.15), color, Enum.Material.Neon)
	elseif weaponId == "scatter" then
		bar("Body", Vector3.new(0.4, 0.4, 0.9), CFrame.new(0.55, -0.42, -1.35))
		bar("Left", Vector3.new(0.14, 0.14, 0.85), CFrame.new(0.42, -0.32, -1.9), color, Enum.Material.Neon)
		bar("Right", Vector3.new(0.14, 0.14, 0.85), CFrame.new(0.68, -0.32, -1.9), color, Enum.Material.Neon)
	else
		bar("Body", Vector3.new(0.22, 0.28, 1.3), CFrame.new(0.5, -0.4, -1.55))
		bar("Barrel", Vector3.new(0.1, 0.1, 0.9), CFrame.new(0.5, -0.32, -2.2), color, Enum.Material.Neon)
	end
	return model
end

function View.start(player)
	local camera = workspace.CurrentCamera
	local recoilPitch = 0
	local recoilYaw = 0
	local punch = 0
	local models = {}
	local currentId = "pulse"
	local orbit = 0

	local function modelFor(weaponId)
		if not models[weaponId] then
			models[weaponId] = weaponModel(weaponId)
		end
		return models[weaponId]
	end

	local function setModelCFrame(model, cf)
		for _, part in ipairs(model:GetChildren()) do
			if part:IsA("BasePart") then
				if not part:GetAttribute("Base") then
					part:SetAttribute("Base", true)
					part:SetAttribute("X", part.CFrame.Position.X)
					part:SetAttribute("Y", part.CFrame.Position.Y)
					part:SetAttribute("Z", part.CFrame.Position.Z)
				end
				local localCf = CFrame.new(part:GetAttribute("X"), part:GetAttribute("Y"), part:GetAttribute("Z"))
				part.CFrame = cf * localCf
			end
		end
	end

	local api = {}

	function api.kick(weaponId)
		local weapon = Weapons.get(weaponId)
		if not weapon then
			return
		end
		local kick = (weapon.recoil and weapon.recoil.kick or 0.02) * KICK_SCALE
		recoilPitch = recoilPitch + kick
		recoilYaw = recoilYaw + (math.random() - 0.5) * kick
		punch = math.min(0.35, punch + 0.12 + kick)
	end

	function api.spread()
		-- Effective cone (base + bloom + movement), not just the accumulated bloom.
		return api._effective or 0
	end

	function api.onFx(payload)
		if type(payload) ~= "table" then
			return
		end
		if payload.kind == "tracer" and typeof(payload.origin) == "Vector3" and typeof(payload.finish) == "Vector3" then
			-- Skip our own server echo; the click already kicked the viewmodel.
			-- Other actors' shots still draw, including our own so hits match the server.
			api.drawBeam(payload.origin, payload.finish, payload.color, payload.width or 0.12, 0.07)
		elseif payload.kind == "boom" and typeof(payload.position) == "Vector3" then
			api.drawBoom(payload.position, payload.radius or 8, payload.color)
		elseif payload.kind == "pulse" and typeof(payload.position) == "Vector3" then
			api.drawBoom(payload.position, payload.radius or 8, payload.color)
		end
	end

	function api.drawBeam(a, b, color, width, life)
		local delta = b - a
		local distance = delta.Magnitude
		if distance < 0.05 then
			return
		end
		local part = Instance.new("Part")
		part.Anchored = true
		part.CanCollide = false
		part.CanQuery = false
		part.Material = Enum.Material.Neon
		part.Color = typeof(color) == "Color3" and color or Color3.fromRGB(120, 255, 220)
		part.Size = Vector3.new(width, width, distance)
		part.CFrame = CFrame.lookAt((a + b) * 0.5, b)
		part.Parent = workspace
		task.delay(life, function()
			if part then
				part:Destroy()
			end
		end)
	end

	function api.drawBoom(position, radius, color)
		local ball = Instance.new("Part")
		ball.Shape = Enum.PartType.Ball
		ball.Anchored = true
		ball.CanCollide = false
		ball.CanQuery = false
		ball.Material = Enum.Material.Neon
		ball.Color = typeof(color) == "Color3" and color or Color3.fromRGB(255, 170, 90)
		ball.Size = Vector3.new(1.5, 1.5, 1.5)
		ball.CFrame = CFrame.new(position)
		ball.Parent = workspace
		task.spawn(function()
			local duration = 0.22
			local started = os.clock()
			while ball.Parent do
				local t = (os.clock() - started) / duration
				if t >= 1 then
					break
				end
				local size = 1.5 + t * math.max(radius, 4)
				ball.Size = Vector3.new(size, size, size)
				ball.Transparency = t
				task.wait()
			end
			ball:Destroy()
		end)
	end

	RunService:BindToRenderStep("COCSView", Enum.RenderPriority.Camera.Value + 1, function(dt)
		camera = workspace.CurrentCamera
		if not camera then
			return
		end
		local inMatch = player:GetAttribute("InMatch") == true
		local weaponId = player:GetAttribute("Weapon") or "pulse"
		local weapon = Weapons.get(weaponId) or Weapons.get("pulse")
		local recover = (weapon.recoil and weapon.recoil.recover or 12)
		recoilPitch = recoilPitch + (0 - recoilPitch) * math.min(1, recover * dt * 0.15)
		recoilYaw = recoilYaw + (0 - recoilYaw) * math.min(1, recover * dt * 0.15)
		punch = math.max(0, punch - dt * 2.4)

		-- Local bloom estimate so the crosshair breathes. Damage spread is server-side.
		local bloom = weapon.bloom or {}
		api._spread = api._spread or 0
		api._spread = math.max(0, api._spread - (bloom.recovery or 0.1) * dt)
		local character = player.Character
		local humanoid = character and character:FindFirstChildOfClass("Humanoid")
		local hrp = character and character:FindFirstChild("HumanoidRootPart")
		local sprinting = UserInputService:IsKeyDown(Enum.KeyCode.LeftShift) or UserInputService:IsKeyDown(Enum.KeyCode.RightShift)
		local speedFrac = 0
		if hrp then
			local velocity = hrp.AssemblyLinearVelocity
			local horizontal = Vector3.new(velocity.X, 0, velocity.Z).Magnitude
			local base = player:GetAttribute("MoveSpeed") or 24
			if sprinting then
				base = base / 1.375
			end
			if base > 1 then
				speedFrac = math.clamp(horizontal / base, 0, 1)
			end
		end
		api._effective = Weapons.effectiveSpread(weapon, api._spread, speedFrac, sprinting)

		if not inMatch then
			player.CameraMode = Enum.CameraMode.Classic
			camera.CameraType = Enum.CameraType.Scriptable
			UserInputService.MouseIconEnabled = true
			UserInputService.MouseBehavior = Enum.MouseBehavior.Default
			orbit = orbit + dt * 0.18
			local focus = Vector3.new(0, 10, -8)
			local position = Vector3.new(math.cos(orbit) * 86, 48, math.sin(orbit) * 86)
			camera.CFrame = CFrame.new(position, focus)
			camera.FieldOfView = 58
			for _, model in pairs(models) do
				model.Parent = nil
			end
			return
		end

		player.CameraMode = Enum.CameraMode.LockFirstPerson
		if camera.CameraType ~= Enum.CameraType.Custom then
			camera.CameraType = Enum.CameraType.Custom
		end
		camera.FieldOfView = 80
		UserInputService.MouseIconEnabled = false
		UserInputService.MouseBehavior = Enum.MouseBehavior.LockCenter
		camera.CFrame = camera.CFrame * CFrame.Angles(recoilPitch, recoilYaw, 0)

		if humanoid and hrp and humanoid.FloorMaterial == Enum.Material.Air then
			local move = humanoid.MoveDirection
			if move.Magnitude > 0.05 then
				local velocity = hrp.AssemblyLinearVelocity
				local horizontal = Vector3.new(velocity.X, 0, velocity.Z)
				local cap = (player:GetAttribute("MoveSpeed") or humanoid.WalkSpeed) * 1.12
				if cap < 8 then
					cap = 8
				end
				local wish = move.Unit * math.min(cap, humanoid.WalkSpeed > 1 and humanoid.WalkSpeed or cap)
				local delta = wish - horizontal
				if delta.Magnitude > 0.05 then
					local add = delta.Unit * math.min(delta.Magnitude, 24 * dt)
					local nextHorizontal = horizontal + add
					if nextHorizontal.Magnitude > cap then
						nextHorizontal = nextHorizontal.Unit * cap
					end
					hrp.AssemblyLinearVelocity = Vector3.new(nextHorizontal.X, velocity.Y, nextHorizontal.Z)
				end
			end
		end

		if currentId ~= weaponId then
			if models[currentId] then
				models[currentId].Parent = nil
			end
			currentId = weaponId
			api._spread = 0
		end
		local model = modelFor(weaponId)
		model.Parent = camera
		local bob = 0
		if hrp then
			bob = math.sin(os.clock() * 10) * math.clamp(hrp.AssemblyLinearVelocity.Magnitude / 80, 0, 0.08)
		end
		local cf = camera.CFrame * CFrame.new(0, bob, punch)
		setModelCFrame(model, cf)
	end)

	function api.noteShot()
		local weapon = Weapons.get(player:GetAttribute("Weapon") or "pulse")
		if not weapon then
			return
		end
		api._spread = Weapons.addSpread(weapon, api._spread or 0)
	end

	return api
end

return View
