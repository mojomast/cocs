-- Blocky operator rigs. Same silhouette vocabulary as the web roster, built from parts.
-- CanCollide is off on limbs; the Humanoid's HipHeight is what stands on the floor.
-- Raycasts still hit the parts (CanQuery stays on) so shots connect.

local ColorUtil = require(game:GetService("ReplicatedStorage"):WaitForChild("Shared"):WaitForChild("ColorUtil"))
local Config = require(game:GetService("ReplicatedStorage"):WaitForChild("Shared"):WaitForChild("Config"))

local Rig = {}

local function part(props)
	local item = Instance.new("Part")
	item.Anchored = false
	item.CanCollide = false
	item.CanQuery = true
	item.CanTouch = false
	item.TopSurface = Enum.SurfaceType.Smooth
	item.BottomSurface = Enum.SurfaceType.Smooth
	item.Material = Enum.Material.SmoothPlastic
	for key, value in pairs(props) do
		item[key] = value
	end
	return item
end

local function weld(parent, child, c0, swing)
	local joint = Instance.new("Weld")
	joint.Name = swing or "Joint"
	joint.Part0 = parent
	joint.Part1 = child
	joint.C0 = c0
	joint.Parent = parent
	if swing then
		joint:SetAttribute("Swing", swing)
	end
	return joint
end

local function addExtra(parent, name, size, c0, color, material, shape)
	local extra = part({
		Name = name,
		Size = size,
		Color = color,
		Material = material or Enum.Material.SmoothPlastic,
		Shape = shape or Enum.PartType.Block,
	})
	extra.Parent = parent.Parent
	weld(parent, extra, c0)
	return extra
end

function Rig.build(displayName, operator, owner)
	local color = ColorUtil.hex(operator.color)
	local accent = ColorUtil.hex(operator.accent)
	local dark = ColorUtil.darken(color, 0.35)

	local model = Instance.new("Model")
	model.Name = displayName

	local hrp = part({
		Name = "HumanoidRootPart",
		Size = Vector3.new(2, 2, 1),
		Transparency = 1,
		Color = color,
	})
	hrp.Parent = model

	local torso = part({
		Name = "Torso",
		Size = Vector3.new(2, 2, 1),
		Color = color,
	})
	torso.Parent = model
	local root = Instance.new("Motor6D")
	root.Name = "RootJoint"
	root.Part0 = hrp
	root.Part1 = torso
	root.C0 = CFrame.new()
	root.Parent = hrp

	local headShape = Enum.PartType.Block
	local headSize = Vector3.new(1.25, 1.25, 1.25)
	if operator.silhouette == "ball" then
		headShape = Enum.PartType.Ball
		headSize = Vector3.new(1.45, 1.45, 1.45)
	end
	local head = part({
		Name = "Head",
		Size = headSize,
		Color = accent,
		Material = Enum.Material.Neon,
		Shape = headShape,
	})
	head.Parent = model
	-- R6 dies on spawn if Head is not jointed to Torso. A plain Weld is not
	-- always enough once this model is assigned as Player.Character.
	local neck = Instance.new("Motor6D")
	neck.Name = "Neck"
	neck.Part0 = torso
	neck.Part1 = head
	neck.C0 = CFrame.new(0, 1.65, 0)
	neck.Parent = torso

	local function limb(name, size, c0, limbColor, swing)
		local limbPart = part({
			Name = name,
			Size = size,
			Color = limbColor,
		})
		limbPart.Parent = model
		weld(torso, limbPart, c0, swing)
	end

	limb("Left Arm", Vector3.new(0.7, 2, 0.7), CFrame.new(-1.4, 0, 0), color, "arm")
	limb("Right Arm", Vector3.new(0.7, 2, 0.7), CFrame.new(1.4, 0, 0), color, "arm")
	limb("Left Leg", Vector3.new(0.8, 2, 0.8), CFrame.new(-0.5, -2, 0), dark, "leg")
	limb("Right Leg", Vector3.new(0.8, 2, 0.8), CFrame.new(0.5, -2, 0), dark, "leg")

	local silhouette = operator.silhouette
	if silhouette == "antenna" then
		addExtra(head, "Antenna", Vector3.new(0.12, 1.3, 0.12), CFrame.new(0.35, 1.15, 0), dark, Enum.Material.Metal)
		addExtra(head, "Tip", Vector3.new(0.28, 0.28, 0.28), CFrame.new(0.35, 1.85, 0), accent, Enum.Material.Neon, Enum.PartType.Ball)
	elseif silhouette == "rings" then
		addExtra(head, "RingA", Vector3.new(0.14, 1.9, 1.9), CFrame.new(0, 0.15, 0) * CFrame.Angles(0, 0, math.rad(90)), accent, Enum.Material.Neon, Enum.PartType.Cylinder)
		addExtra(head, "RingB", Vector3.new(0.14, 1.55, 1.55), CFrame.new(0, -0.15, 0) * CFrame.Angles(0, 0, math.rad(90)), color, Enum.Material.Neon, Enum.PartType.Cylinder)
	elseif silhouette == "halo" then
		addExtra(head, "Halo", Vector3.new(0.12, 1.85, 1.85), CFrame.new(0, 0.85, 0) * CFrame.Angles(0, 0, math.rad(90)), accent, Enum.Material.Neon, Enum.PartType.Cylinder)
	elseif silhouette == "fin" then
		addExtra(head, "Fin", Vector3.new(0.16, 1.5, 0.7), CFrame.new(0, 1.2, 0), accent, Enum.Material.Neon)
	elseif silhouette == "visor" then
		addExtra(head, "Visor", Vector3.new(1.05, 0.28, 0.2), CFrame.new(0, 0.05, -0.62), accent, Enum.Material.Neon)
	elseif silhouette == "steps" then
		addExtra(head, "CrestA", Vector3.new(0.9, 0.28, 0.7), CFrame.new(0, 0.85, 0), accent, Enum.Material.Neon)
		addExtra(head, "CrestB", Vector3.new(0.55, 0.28, 0.45), CFrame.new(0, 1.15, 0), color, Enum.Material.Neon)
	elseif silhouette == "stripe" then
		addExtra(torso, "Stripe", Vector3.new(2.05, 0.28, 1.05), CFrame.new(0, 0.35, 0), accent, Enum.Material.Neon)
		addExtra(torso, "PauldronL", Vector3.new(0.55, 0.4, 1.05), CFrame.new(-1.15, 0.85, 0), accent)
		addExtra(torso, "PauldronR", Vector3.new(0.55, 0.4, 1.05), CFrame.new(1.15, 0.85, 0), accent)
	elseif silhouette == "shoulders" then
		addExtra(torso, "PadL", Vector3.new(0.7, 0.35, 1.15), CFrame.new(-1.2, 0.9, 0), accent, Enum.Material.Neon)
		addExtra(torso, "PadR", Vector3.new(0.7, 0.35, 1.15), CFrame.new(1.2, 0.9, 0), accent, Enum.Material.Neon)
	elseif silhouette == "ball" then
		addExtra(head, "Cheek", Vector3.new(0.35, 0.35, 0.2), CFrame.new(0, -0.1, -0.7), color, Enum.Material.SmoothPlastic)
	end

	local billboard = Instance.new("BillboardGui")
	billboard.Name = "Nameplate"
	billboard.Size = UDim2.fromOffset(160, 40)
	billboard.StudsOffset = Vector3.new(0, 3.1, 0)
	billboard.AlwaysOnTop = true
	billboard.MaxDistance = 180
	if owner then
		billboard.PlayerToHideFrom = owner
	end
	billboard.Parent = head

	local label = Instance.new("TextLabel")
	label.Name = "Label"
	label.BackgroundTransparency = 1
	label.Size = UDim2.new(1, 0, 0.62, 0)
	label.Font = Enum.Font.GothamBold
	label.TextSize = 14
	label.TextColor3 = accent
	label.TextStrokeTransparency = 0.4
	label.Text = string.upper(operator.name)
	label.Parent = billboard

	local barBack = Instance.new("Frame")
	barBack.Name = "BarBack"
	barBack.BackgroundColor3 = Color3.fromRGB(8, 10, 14)
	barBack.BorderSizePixel = 0
	barBack.Position = UDim2.new(0.15, 0, 0.68, 0)
	barBack.Size = UDim2.new(0.7, 0, 0.22, 0)
	barBack.Parent = billboard

	local bar = Instance.new("Frame")
	bar.Name = "Bar"
	bar.BackgroundColor3 = color
	bar.BorderSizePixel = 0
	bar.Size = UDim2.fromScale(1, 1)
	bar.Parent = barBack

	local humanoid = Instance.new("Humanoid")
	humanoid.Name = "Humanoid"
	humanoid.RigType = Enum.HumanoidRigType.R6
	humanoid.AutomaticScalingEnabled = false
	humanoid.HipHeight = 2
	humanoid.UseJumpPower = false
	humanoid.JumpHeight = Config.JUMP_METRES * Config.SCALE
	humanoid.MaxHealth = operator.health
	humanoid.Health = operator.health
	humanoid.BreakJointsOnDeath = false
	humanoid.RequiresNeck = false
	humanoid.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.None
	humanoid.HealthDisplayType = Enum.HumanoidHealthDisplayType.AlwaysOff
	humanoid.Parent = model
	humanoid:SetStateEnabled(Enum.HumanoidStateType.FallingDown, false)
	humanoid:SetStateEnabled(Enum.HumanoidStateType.Ragdoll, false)

	model.PrimaryPart = hrp
	model:SetAttribute("Operator", operator.id)
	return model
end

function Rig.setHealthBar(model, fraction)
	local head = model:FindFirstChild("Head")
	if not head then
		return
	end
	local plate = head:FindFirstChild("Nameplate")
	if not plate then
		return
	end
	local back = plate:FindFirstChild("BarBack")
	local bar = back and back:FindFirstChild("Bar")
	if bar then
		bar.Size = UDim2.fromScale(math.clamp(fraction, 0, 1), 1)
	end
end

return Rig
