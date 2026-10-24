-- Builds The Exchange from parts. 1 metre = Config.SCALE studs.
-- The raised gantry is -Z. Ramps are rotated slabs (local +Z runs downhill toward +Z)
-- with solid fill underneath so there is no cave, matching the web floor function.

local Config = require(game:GetService("ReplicatedStorage"):WaitForChild("Shared"):WaitForChild("Config"))
local Arena = require(game:GetService("ReplicatedStorage"):WaitForChild("Shared"):WaitForChild("Arena"))

local ArenaBuilder = {}

local S = Config.SCALE

local function studs(metres)
	return metres * S
end

local PALETTE = {
	floor = Color3.fromRGB(28, 34, 42),
	wall = Color3.fromRGB(16, 22, 30),
	trim = Color3.fromRGB(93, 203, 188),
	deck = Color3.fromRGB(36, 44, 54),
	cover = Color3.fromRGB(52, 62, 74),
	reactor = Color3.fromRGB(22, 32, 36),
	hazard = Color3.fromRGB(70, 78, 70),
}

local function makePart(parent, props)
	local item = Instance.new(props.class or "Part")
	item.Anchored = true
	item.TopSurface = Enum.SurfaceType.Smooth
	item.BottomSurface = Enum.SurfaceType.Smooth
	item.CanCollide = props.collide ~= false
	item.CanQuery = props.query ~= false
	item.CanTouch = false
	item.Material = props.material or Enum.Material.Metal
	item.Color = props.color or PALETTE.wall
	item.Name = props.name or "Block"
	item.Size = props.size
	item.CFrame = props.cframe
	if props.transparency then
		item.Transparency = props.transparency
	end
	if props.shape then
		item.Shape = props.shape
	end
	item.Parent = parent
	return item
end

local function metersBox(parent, name, x, y, z, w, h, d, color, material, collide, query)
	return makePart(parent, {
		name = name,
		size = Vector3.new(studs(w), studs(h), studs(d)),
		cframe = CFrame.new(studs(x), studs(y), studs(z)),
		color = color,
		material = material,
		collide = collide,
		query = query,
	})
end

local function addRamp(geometry, sign)
	-- Walkable surface from z = 3 (y = 0) to z = -9 (y = 3.8), |x| centered near 11.1.
	-- Positive X rotation drops the local +Z end. That end points at world +Z,
	-- which is the ramp foot; the gantry (-Z) stays high.
	local rise = studs(3.8)
	local run = studs(12)
	local thickness = 1.15
	local width = studs(6.2)
	local angle = math.atan2(rise, run)
	local hyp = math.sqrt(rise * rise + run * run) + 1.4
	local midX = studs(sign * 11.1)
	local midZ = studs(-3)
	local cf = CFrame.new(midX, rise * 0.5, midZ) * CFrame.Angles(angle, 0, 0) * CFrame.new(0, -thickness * 0.5, 0)
	makePart(geometry, {
		name = sign < 0 and "WestRamp" or "EastRamp",
		size = Vector3.new(width, thickness, hyp),
		cframe = cf,
		color = PALETTE.deck,
		material = Enum.Material.DiamondPlate,
	})

	-- Fill under the slope so you cannot camp in a cave. Tops stay under the walking surface.
	local segments = {
		{ z0 = 0, z1 = 3 },
		{ z0 = -3, z1 = 0 },
		{ z0 = -6, z1 = -3 },
		{ z0 = -9, z1 = -6 },
	}
	for index, segment in ipairs(segments) do
		local topMetres = Arena.floorMetres(sign * 11.1, segment.z0) - 0.2
		if topMetres > 0.35 then
			local height = topMetres
			local depth = segment.z1 - segment.z0
			local centerZ = (segment.z0 + segment.z1) * 0.5
			metersBox(
				geometry,
				(sign < 0 and "WestFill" or "EastFill") .. index,
				sign * 11.1,
				height * 0.5,
				centerZ,
				6.2,
				height,
				depth,
				PALETTE.wall,
				Enum.Material.Concrete
			)
		end
	end

	-- Side barrier. Stops a jump from the pit straight onto the ramp.
	metersBox(
		geometry,
		sign < 0 and "WestRampWall" or "EastRampWall",
		sign * 8.05,
		2.2,
		-3,
		0.28,
		4.4,
		12,
		PALETTE.hazard,
		Enum.Material.Concrete
	)
end

local function addRing(cosmetic, yMetres, radiusMetres, name)
	local count = 10
	local radius = studs(radiusMetres)
	for i = 1, count do
		local theta = (i / count) * math.pi * 2
		local piece = makePart(cosmetic, {
			name = name .. i,
			size = Vector3.new(studs(0.7), studs(0.18), studs(0.45)),
			cframe = CFrame.new(math.cos(theta) * radius, studs(yMetres), math.sin(theta) * radius)
				* CFrame.Angles(0, -theta, 0),
			color = PALETTE.trim,
			material = Enum.Material.Neon,
			collide = false,
			query = false,
		})
		piece.Transparency = 0.15
	end
end

local function addLabel(part, text, face)
	local gui = Instance.new("SurfaceGui")
	gui.Face = face or Enum.NormalId.Front
	gui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	gui.PixelsPerStud = 18
	gui.Parent = part
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Size = UDim2.fromScale(1, 1)
	label.Font = Enum.Font.GothamBold
	label.TextScaled = true
	label.TextColor3 = PALETTE.trim
	label.TextTransparency = 0.15
	label.Text = text
	label.Parent = gui
end

function ArenaBuilder.build(arenaFolder)
	arenaFolder:ClearAllChildren()

	local geometry = Instance.new("Folder")
	geometry.Name = "Geometry"
	geometry.Parent = arenaFolder

	local cosmetic = Instance.new("Folder")
	cosmetic.Name = "Cosmetic"
	cosmetic.Parent = arenaFolder

	-- Floor slab. Top sits on y = 0.
	metersBox(geometry, "Floor", 0, -0.5, 0, 34, 1, 34, PALETTE.floor, Enum.Material.DiamondPlate)

	-- Shell. Inner faces land on ±14.
	metersBox(geometry, "WallWest", -14.5, 4.5, 0, 1, 9, 30, PALETTE.wall, Enum.Material.Concrete)
	metersBox(geometry, "WallEast", 14.5, 4.5, 0, 1, 9, 30, PALETTE.wall, Enum.Material.Concrete)
	local wallNorth = metersBox(geometry, "WallNorth", 0, 4.5, 14.5, 30, 9, 1, PALETTE.wall, Enum.Material.Concrete)
	local wallSouth = metersBox(geometry, "WallSouth", 0, 4.5, -14.5, 30, 9, 1, PALETTE.wall, Enum.Material.Concrete)
	addLabel(wallNorth, "PIT", Enum.NormalId.Front)
	addLabel(wallSouth, "GANTRY", Enum.NormalId.Back)
	addLabel(geometry.WallWest, "WEST RAMP", Enum.NormalId.Right)
	addLabel(geometry.WallEast, "EAST RAMP", Enum.NormalId.Left)

	-- Central reactor, line-of-sight blocker.
	local reactor = metersBox(geometry, "Reactor", 0, 2.7, 0, 4, 5.4, 4, PALETTE.reactor, Enum.Material.Metal)
	local light = Instance.new("PointLight")
	light.Color = PALETTE.trim
	light.Brightness = 2.4
	light.Range = 28
	light.Parent = reactor
	addRing(cosmetic, 1.2, 2.55, "RingLow")
	addRing(cosmetic, 2.7, 2.7, "RingMid")
	addRing(cosmetic, 4.3, 2.45, "RingHigh")

	-- Low cover. Authored sizes from game/maps.mjs cover() calls.
	metersBox(geometry, "CoverNW", -6, 0.95, 5, 3, 1.9, 1.4, PALETTE.cover, Enum.Material.DiamondPlate)
	metersBox(geometry, "CoverNE", 6, 0.95, 5, 3, 1.9, 1.4, PALETTE.cover, Enum.Material.DiamondPlate)
	metersBox(geometry, "CoverSW", -5, 1.05, -5, 2.2, 2.1, 1.4, PALETTE.cover, Enum.Material.DiamondPlate)
	metersBox(geometry, "CoverSE", 5, 1.05, -5, 2.2, 2.1, 1.4, PALETTE.cover, Enum.Material.DiamondPlate)

	-- Gantry deck. Solid from the floor up (the web map has no underpass).
	local deck = metersBox(geometry, "Deck", 0, 1.9, -12, 28, 3.8, 6, PALETTE.deck, Enum.Material.DiamondPlate)
	addLabel(deck, "HIGH GROUND", Enum.NormalId.Back)

	addRamp(geometry, -1)
	addRamp(geometry, 1)

	-- Floor panel lines and a gantry edge strip. Cosmetic only.
	for i = -2, 2 do
		local strip = makePart(cosmetic, {
			name = "Lane" .. i,
			size = Vector3.new(0.15, 0.08, studs(26)),
			cframe = CFrame.new(studs(i * 4), 0.08, studs(2)),
			color = PALETTE.trim,
			material = Enum.Material.Neon,
			collide = false,
			query = false,
		})
		strip.Transparency = 0.55
	end
	local lip = makePart(cosmetic, {
		name = "GantryLip",
		size = Vector3.new(studs(20), 0.12, 0.18),
		cframe = CFrame.new(0, studs(3.8) + 0.1, studs(-9)),
		color = PALETTE.trim,
		material = Enum.Material.Neon,
		collide = false,
		query = false,
	})
	lip.Transparency = 0.2

	-- Trusses across the open roof so the box reads as a chamber, not a cage.
	for _, z in ipairs({ -8, 0, 8 }) do
		makePart(cosmetic, {
			name = "Truss",
			size = Vector3.new(studs(28), 0.25, 0.35),
			cframe = CFrame.new(0, studs(8.6), studs(z)),
			color = PALETTE.trim,
			material = Enum.Material.Metal,
			collide = false,
			query = false,
		}).Transparency = 0.35
	end

	-- Spawn pads.
	for index, spawn in ipairs(Arena.spawns) do
		local y = Arena.floorMetres(spawn.x, spawn.z)
		local pad = makePart(cosmetic, {
			name = "Spawn" .. index,
			size = Vector3.new(2.4, 0.12, 2.4),
			cframe = CFrame.new(studs(spawn.x), studs(y) + 0.1, studs(spawn.z)),
			color = PALETTE.trim,
			material = Enum.Material.Neon,
			collide = false,
			query = false,
			shape = Enum.PartType.Cylinder,
		})
		pad.Transparency = 0.45
		-- Cylinder axis is X; lay the disc flat.
		pad.CFrame = CFrame.new(studs(spawn.x), studs(y) + 0.08, studs(spawn.z)) * CFrame.Angles(0, 0, math.rad(90))
		pad.Size = Vector3.new(0.12, 3.2, 3.2)
	end

	return geometry, cosmetic
end

function ArenaBuilder.lighting()
	local Lighting = game:GetService("Lighting")
	Lighting.ClockTime = 17.2
	Lighting.Brightness = 2
	Lighting.Ambient = Color3.fromRGB(40, 46, 56)
	Lighting.OutdoorAmbient = Color3.fromRGB(56, 66, 76)
	Lighting.GlobalShadows = true
	Lighting.EnvironmentDiffuseScale = 0.35
	Lighting.EnvironmentSpecularScale = 0.5
	workspace.Gravity = Config.GRAVITY

	local atmosphere = Lighting:FindFirstChild("COCSAtmosphere")
	if not atmosphere then
		atmosphere = Instance.new("Atmosphere")
		atmosphere.Name = "COCSAtmosphere"
		atmosphere.Parent = Lighting
	end
	atmosphere.Density = 0.28
	atmosphere.Offset = 0.15
	atmosphere.Color = Color3.fromRGB(150, 176, 178)
	atmosphere.Decay = Color3.fromRGB(90, 120, 130)
	atmosphere.Glare = 0.15
	atmosphere.Haze = 1.1
end

return ArenaBuilder
