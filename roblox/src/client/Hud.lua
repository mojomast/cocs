-- Operator select, HUD, scoreboard, and the results card.
-- Colors follow the web menu: carbon panels, teal type, orange highlights.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Operators = require(Shared:WaitForChild("Operators"))
local Weapons = require(Shared:WaitForChild("Weapons"))
local ColorUtil = require(Shared:WaitForChild("ColorUtil"))

local Hud = {}

local THEME = {
	bg = Color3.fromRGB(8, 12, 16),
	panel = Color3.fromRGB(12, 16, 22),
	line = Color3.fromRGB(46, 84, 78),
	text = Color3.fromRGB(226, 244, 238),
	muted = Color3.fromRGB(130, 156, 150),
	teal = Color3.fromRGB(93, 203, 188),
	orange = Color3.fromRGB(242, 157, 113),
	danger = Color3.fromRGB(255, 92, 78),
}

local function corner(parent, radius)
	local item = Instance.new("UICorner")
	item.CornerRadius = UDim.new(0, radius or 6)
	item.Parent = parent
	return item
end

local function stroke(parent, color, thickness)
	local item = Instance.new("UIStroke")
	item.Color = color or THEME.line
	item.Thickness = thickness or 1
	item.Parent = parent
	return item
end

local function label(props)
	local item = Instance.new("TextLabel")
	item.BackgroundTransparency = 1
	item.Font = props.font or Enum.Font.Gotham
	item.TextSize = props.textSize or 14
	item.TextXAlignment = props.align or Enum.TextXAlignment.Left
	item.TextYAlignment = props.valign or Enum.TextYAlignment.Center
	item.TextColor3 = props.color or THEME.text
	item.Text = props.text or ""
	item.Size = props.size or UDim2.fromScale(1, 1)
	item.Position = props.position or UDim2.fromScale(0, 0)
	item.TextWrapped = props.wrap or false
	if props.name then
		item.Name = props.name
	end
	item.Parent = props.parent
	return item
end

function Hud.mount(player, onDeploy)
	local gui = Instance.new("ScreenGui")
	gui.Name = "COCS"
	gui.ResetOnSpawn = false
	gui.IgnoreGuiInset = true
	gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	gui.Parent = player:WaitForChild("PlayerGui")

	local selected = "chatgpt"
	local boardOpen = false
	local hurtAlpha = 0
	local feedLines = {}

	local select = Instance.new("Frame")
	select.Name = "Select"
	select.Size = UDim2.fromScale(1, 1)
	select.BackgroundTransparency = 1
	-- Inactive so this full-screen frame cannot swallow clicks meant for cards.
	select.Active = false
	select.Parent = gui

	local title = label({
		parent = select,
		text = "COLOSSEUM OF COMPETITIVE SLOP",
		font = Enum.Font.GothamBold,
		textSize = 22,
		color = THEME.teal,
		position = UDim2.fromOffset(28, 18),
		size = UDim2.new(1, -360, 0, 28),
	})
	title.TextXAlignment = Enum.TextXAlignment.Left

	label({
		parent = select,
		name = "Sub",
		text = "ROBLOX V1  ·  THE EXCHANGE  ·  FREE FOR ALL",
		textSize = 13,
		color = THEME.muted,
		position = UDim2.fromOffset(28, 46),
		size = UDim2.new(0.5, 0, 0, 18),
	})

	local list = Instance.new("ScrollingFrame")
	list.Name = "Roster"
	list.BackgroundColor3 = THEME.panel
	list.BackgroundTransparency = 0.12
	list.BorderSizePixel = 0
	list.Position = UDim2.fromOffset(24, 84)
	list.Size = UDim2.new(0, 340, 1, -210)
	list.ZIndex = 2
	list.ScrollBarThickness = 4
	list.ScrollBarImageColor3 = THEME.teal
	list.CanvasSize = UDim2.fromOffset(0, #Operators.all() * 78 + 12)
	list.Parent = select
	corner(list, 8)
	stroke(list, THEME.line)

	local layout = Instance.new("UIListLayout")
	layout.Padding = UDim.new(0, 6)
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Parent = list
	local pad = Instance.new("UIPadding")
	pad.PaddingTop = UDim.new(0, 8)
	pad.PaddingLeft = UDim.new(0, 8)
	pad.PaddingRight = UDim.new(0, 8)
	pad.Parent = list

	local cards = {}
	for index, operator in ipairs(Operators.all()) do
		local card = Instance.new("TextButton")
		card.Name = operator.id
		card.AutoButtonColor = false
		card.Text = ""
		card.BackgroundColor3 = THEME.bg
		card.BorderSizePixel = 0
		card.Size = UDim2.new(1, -8, 0, 70)
		card.LayoutOrder = index
		card.Parent = list
		corner(card, 6)
		local cardStroke = stroke(card, THEME.line)
		local swatch = Instance.new("Frame")
		swatch.BackgroundColor3 = ColorUtil.hex(operator.color)
		swatch.BorderSizePixel = 0
		swatch.Size = UDim2.new(0, 8, 1, -12)
		swatch.Position = UDim2.fromOffset(8, 6)
		swatch.Parent = card
		corner(swatch, 3)
		label({
			parent = card,
			text = string.upper(operator.name),
			font = Enum.Font.GothamBold,
			textSize = 16,
			position = UDim2.fromOffset(26, 6),
			size = UDim2.new(1, -34, 0, 20),
		})
		label({
			parent = card,
			text = operator.tag,
			textSize = 11,
			color = THEME.orange,
			position = UDim2.fromOffset(26, 26),
			size = UDim2.new(1, -34, 0, 14),
		})
		local harness = Operators.harnessOf(operator)
		label({
			parent = card,
			text = string.format("HP %d   ARM %d   %0.1f m/s   ·   %s", operator.health, operator.armor, operator.speed, harness.power),
			textSize = 12,
			color = THEME.muted,
			position = UDim2.fromOffset(26, 44),
			size = UDim2.new(1, -34, 0, 16),
		})
		card.MouseButton1Click:Connect(function()
			selected = operator.id
			Hud._paintCards()
		end)
		cards[operator.id] = { button = card, stroke = cardStroke }
	end

	local detail = Instance.new("Frame")
	detail.Name = "Detail"
	detail.BackgroundColor3 = THEME.panel
	detail.BackgroundTransparency = 0.12
	detail.BorderSizePixel = 0
	detail.AnchorPoint = Vector2.new(1, 0)
	detail.Position = UDim2.new(1, -24, 0, 84)
	detail.Size = UDim2.new(0, 320, 0, 280)
	detail.Parent = select
	corner(detail, 8)
	stroke(detail, THEME.line)

	local detailName = label({
		parent = detail,
		name = "Name",
		text = "CHATGPT",
		font = Enum.Font.GothamBold,
		textSize = 22,
		position = UDim2.fromOffset(16, 14),
		size = UDim2.new(1, -32, 0, 28),
	})
	local detailTag = label({
		parent = detail,
		name = "Tag",
		text = "",
		textSize = 12,
		color = THEME.orange,
		position = UDim2.fromOffset(16, 44),
		size = UDim2.new(1, -32, 0, 16),
	})
	local detailBlurb = label({
		parent = detail,
		name = "Blurb",
		text = "",
		textSize = 14,
		color = THEME.text,
		position = UDim2.fromOffset(16, 72),
		size = UDim2.new(1, -32, 0, 64),
		wrap = true,
		valign = Enum.TextYAlignment.Top,
	})
	local detailAbility = label({
		parent = detail,
		name = "Ability",
		text = "",
		textSize = 14,
		color = THEME.teal,
		position = UDim2.fromOffset(16, 150),
		size = UDim2.new(1, -32, 0, 90),
		wrap = true,
		valign = Enum.TextYAlignment.Top,
	})

	-- Own ScreenGui so the roster, the detail card, and the full-screen select
	-- frame cannot sit on top of DEPLOY. DisplayOrder puts it above COCS.
	local deployGui = Instance.new("ScreenGui")
	deployGui.Name = "COCSDeploy"
	deployGui.ResetOnSpawn = false
	deployGui.IgnoreGuiInset = true
	deployGui.DisplayOrder = 30
	deployGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	deployGui.Parent = gui.Parent

	local deploy = Instance.new("TextButton")
	deploy.Name = "Deploy"
	deploy.AnchorPoint = Vector2.new(0.5, 1)
	deploy.Position = UDim2.new(0.5, 0, 1, -28)
	deploy.Size = UDim2.fromOffset(280, 48)
	deploy.BackgroundColor3 = THEME.teal
	deploy.BorderSizePixel = 0
	deploy.Font = Enum.Font.GothamBold
	deploy.TextSize = 18
	deploy.TextColor3 = Color3.fromRGB(8, 16, 16)
	deploy.Text = "DEPLOY"
	deploy.Active = true
	deploy.Selectable = true
	deploy.AutoButtonColor = true
	deploy.Parent = deployGui
	corner(deploy, 6)

	local hint = label({
		parent = deployGui,
		text = "DEPLOY, Enter, E, or Space.  1–9 picks a card.",
		textSize = 13,
		color = THEME.muted,
		align = Enum.TextXAlignment.Center,
		position = UDim2.new(0.5, -220, 1, -112),
		size = UDim2.fromOffset(440, 18),
	})
	hint.Active = false
	hint.Selectable = false

	-- In-match HUD
	local hud = Instance.new("Frame")
	hud.Name = "Hud"
	hud.Size = UDim2.fromScale(1, 1)
	hud.BackgroundTransparency = 1
	hud.Visible = false
	-- Full-screen and inactive. An Active HUD steals the click, unlocks the
	-- mouse, and the recenter shows up as a look snap.
	hud.Active = false
	hud.Parent = gui

	local top = label({
		parent = hud,
		name = "Top",
		text = "5:00",
		font = Enum.Font.GothamBold,
		textSize = 28,
		color = THEME.teal,
		align = Enum.TextXAlignment.Center,
		position = UDim2.new(0.5, -80, 0, 16),
		size = UDim2.fromOffset(160, 32),
	})
	local sub = label({
		parent = hud,
		name = "Sub",
		text = "FIRST TO 15",
		textSize = 12,
		color = THEME.muted,
		align = Enum.TextXAlignment.Center,
		position = UDim2.new(0.5, -100, 0, 46),
		size = UDim2.fromOffset(200, 16),
	})

	local score = Instance.new("Frame")
	score.Name = "Score"
	score.BackgroundColor3 = THEME.panel
	score.BackgroundTransparency = 0.25
	score.BorderSizePixel = 0
	score.Position = UDim2.fromOffset(16, 16)
	score.Size = UDim2.fromOffset(230, 220)
	score.Parent = hud
	corner(score, 8)
	stroke(score, THEME.line)
	label({
		parent = score,
		text = "SCORE",
		font = Enum.Font.GothamBold,
		textSize = 11,
		color = THEME.muted,
		position = UDim2.fromOffset(10, 4),
		size = UDim2.new(1, -20, 0, 16),
	})
	local scoreList = Instance.new("Frame")
	scoreList.Name = "Rows"
	scoreList.BackgroundTransparency = 1
	scoreList.Position = UDim2.fromOffset(8, 24)
	scoreList.Size = UDim2.new(1, -16, 1, -30)
	scoreList.Parent = score
	local scoreLayout = Instance.new("UIListLayout")
	scoreLayout.Padding = UDim.new(0, 2)
	scoreLayout.Parent = scoreList

	local health = label({
		parent = hud,
		name = "Health",
		text = "100",
		font = Enum.Font.GothamBold,
		textSize = 42,
		color = THEME.teal,
		position = UDim2.new(0, 24, 1, -92),
		size = UDim2.fromOffset(120, 46),
	})
	local armor = label({
		parent = hud,
		name = "Armor",
		text = "ARM 0",
		textSize = 16,
		color = Color3.fromRGB(140, 190, 255),
		position = UDim2.new(0, 24, 1, -44),
		size = UDim2.fromOffset(160, 20),
	})
	label({
		parent = hud,
		text = "SHIFT SPRINT    Q ABILITY    TAB SCORE    BACKSPACE LOADOUT",
		textSize = 12,
		color = THEME.muted,
		align = Enum.TextXAlignment.Center,
		position = UDim2.new(0.5, -220, 1, -28),
		size = UDim2.fromOffset(440, 16),
	})
	local ability = label({
		parent = hud,
		name = "Ability",
		text = "Q  READY",
		font = Enum.Font.GothamBold,
		textSize = 14,
		color = THEME.orange,
		align = Enum.TextXAlignment.Center,
		position = UDim2.new(0.5, -140, 1, -52),
		size = UDim2.fromOffset(280, 20),
	})
	local weapon = label({
		parent = hud,
		name = "Weapon",
		text = "PULSE",
		font = Enum.Font.GothamBold,
		textSize = 20,
		align = Enum.TextXAlignment.Right,
		position = UDim2.new(1, -240, 1, -78),
		size = UDim2.fromOffset(210, 26),
	})
	local ammo = label({
		parent = hud,
		name = "Ammo",
		text = "∞",
		textSize = 16,
		color = THEME.muted,
		align = Enum.TextXAlignment.Right,
		position = UDim2.new(1, -240, 1, -48),
		size = UDim2.fromOffset(210, 20),
	})

	local cross = Instance.new("Frame")
	cross.Name = "Cross"
	cross.AnchorPoint = Vector2.new(0.5, 0.5)
	cross.Position = UDim2.fromScale(0.5, 0.5)
	cross.Size = UDim2.fromOffset(8, 8)
	cross.BackgroundTransparency = 1
	cross.Parent = hud
	local function hair(size, pos)
		local line = Instance.new("Frame")
		line.BackgroundColor3 = THEME.text
		line.BorderSizePixel = 0
		line.AnchorPoint = Vector2.new(0.5, 0.5)
		line.Size = size
		line.Position = pos
		line.Parent = cross
		return line
	end
	local hairL = hair(UDim2.fromOffset(10, 2), UDim2.new(0.5, -16, 0.5, 0))
	local hairR = hair(UDim2.fromOffset(10, 2), UDim2.new(0.5, 16, 0.5, 0))
	local hairU = hair(UDim2.fromOffset(2, 10), UDim2.new(0.5, 0, 0.5, -16))
	local hairD = hair(UDim2.fromOffset(2, 10), UDim2.new(0.5, 0, 0.5, 16))
	local dot = Instance.new("Frame")
	dot.AnchorPoint = Vector2.new(0.5, 0.5)
	dot.Position = UDim2.fromScale(0.5, 0.5)
	dot.Size = UDim2.fromOffset(3, 3)
	dot.BackgroundColor3 = THEME.teal
	dot.BorderSizePixel = 0
	dot.Parent = cross

	local marker = Instance.new("Frame")
	marker.Name = "Marker"
	marker.AnchorPoint = Vector2.new(0.5, 0.5)
	marker.Position = UDim2.fromScale(0.5, 0.5)
	marker.Size = UDim2.fromOffset(18, 18)
	marker.BackgroundTransparency = 1
	marker.Visible = false
	marker.Parent = hud
	local function tick(rot)
		local line = Instance.new("Frame")
		line.AnchorPoint = Vector2.new(0.5, 0.5)
		line.Position = UDim2.fromScale(0.5, 0.5)
		line.Size = UDim2.fromOffset(2, 10)
		line.BackgroundColor3 = Color3.new(1, 1, 1)
		line.BorderSizePixel = 0
		line.Rotation = rot
		line.Parent = marker
	end
	tick(45)
	tick(135)
	tick(225)
	tick(315)

	local vignette = Instance.new("Frame")
	vignette.Name = "Vignette"
	vignette.Size = UDim2.fromScale(1, 1)
	vignette.BackgroundColor3 = THEME.danger
	vignette.BackgroundTransparency = 1
	vignette.BorderSizePixel = 0
	vignette.Parent = hud
	stroke(vignette, THEME.danger, 8).Transparency = 1
	local vignetteStroke = vignette:FindFirstChildOfClass("UIStroke")

	local feed = Instance.new("Frame")
	feed.Name = "Feed"
	feed.BackgroundTransparency = 1
	feed.Position = UDim2.new(0, 16, 0, 250)
	feed.Size = UDim2.fromOffset(360, 140)
	feed.Parent = hud
	local feedLayout = Instance.new("UIListLayout")
	feedLayout.Padding = UDim.new(0, 2)
	feedLayout.VerticalAlignment = Enum.VerticalAlignment.Bottom
	feedLayout.Parent = feed

	local results = Instance.new("Frame")
	results.Name = "Results"
	results.AnchorPoint = Vector2.new(0.5, 0.5)
	results.Position = UDim2.fromScale(0.5, 0.5)
	results.Size = UDim2.fromOffset(460, 220)
	results.BackgroundColor3 = THEME.panel
	results.Visible = false
	results.Parent = gui
	corner(results, 8)
	stroke(results, THEME.teal, 1.5)
	local resultTitle = label({
		parent = results,
		name = "Title",
		text = "ROUND",
		font = Enum.Font.GothamBold,
		textSize = 28,
		color = THEME.teal,
		align = Enum.TextXAlignment.Center,
		position = UDim2.fromOffset(16, 18),
		size = UDim2.new(1, -32, 0, 36),
	})
	local resultBody = label({
		parent = results,
		name = "Body",
		text = "",
		textSize = 16,
		color = THEME.text,
		align = Enum.TextXAlignment.Center,
		position = UDim2.fromOffset(16, 64),
		size = UDim2.new(1, -32, 0, 48),
		wrap = true,
	})
	local again = Instance.new("TextButton")
	again.Name = "Operator"
	again.Position = UDim2.new(0.5, -140, 1, -62)
	again.Size = UDim2.fromOffset(280, 40)
	again.BackgroundColor3 = THEME.bg
	again.BorderSizePixel = 0
	again.Font = Enum.Font.GothamBold
	again.TextSize = 14
	again.TextColor3 = THEME.teal
	again.Text = "CHANGE OPERATOR"
	again.Parent = results
	corner(again, 6)
	stroke(again, THEME.line)

	local fullBoard = Instance.new("Frame")
	fullBoard.Name = "Board"
	fullBoard.AnchorPoint = Vector2.new(0.5, 0.5)
	fullBoard.Position = UDim2.fromScale(0.5, 0.5)
	fullBoard.Size = UDim2.fromOffset(480, 360)
	fullBoard.BackgroundColor3 = THEME.panel
	fullBoard.Visible = false
	fullBoard.Parent = gui
	corner(fullBoard, 8)
	stroke(fullBoard, THEME.teal)
	label({
		parent = fullBoard,
		text = "SCOREBOARD",
		font = Enum.Font.GothamBold,
		textSize = 14,
		color = THEME.muted,
		align = Enum.TextXAlignment.Center,
		position = UDim2.fromOffset(0, 8),
		size = UDim2.new(1, 0, 0, 20),
	})
	local fullList = Instance.new("Frame")
	fullList.BackgroundTransparency = 1
	fullList.Position = UDim2.fromOffset(16, 36)
	fullList.Size = UDim2.new(1, -32, 1, -48)
	fullList.Parent = fullBoard
	local fullLayout = Instance.new("UIListLayout")
	fullLayout.Padding = UDim.new(0, 4)
	fullLayout.Parent = fullList

	local api = {}
	local nextRows = 0

	function Hud._paintCards()
		local operator = Operators.get(selected)
		if not operator then
			return
		end
		for id, card in pairs(cards) do
			local on = id == selected
			card.stroke.Color = on and THEME.teal or THEME.line
			card.stroke.Thickness = on and 1.5 or 1
			card.button.BackgroundColor3 = on and Color3.fromRGB(16, 28, 28) or THEME.bg
		end
		local harness = Operators.harnessOf(operator)
		detailName.Text = string.upper(operator.name)
		detailName.TextColor3 = ColorUtil.hex(operator.color)
		detailTag.Text = operator.tag
		detailBlurb.Text = operator.blurb
		detailAbility.Text = string.format("%s  ·  %s\n%s\nQ to use. Cooldown %ds.", harness.name, harness.power, harness.blurb, harness.cooldown)
	end

	local function clockText(seconds)
		seconds = math.max(0, math.floor(seconds + 0.5))
		return string.format("%d:%02d", math.floor(seconds / 60), seconds % 60)
	end

	local function rows()
		local roster = ReplicatedStorage:FindFirstChild("Roster")
		local items = {}
		if not roster then
			return items
		end
		for _, child in ipairs(roster:GetChildren()) do
			table.insert(items, {
				name = child:GetAttribute("Name") or "?",
				kills = child:GetAttribute("Kills") or 0,
				deaths = child:GetAttribute("Deaths") or 0,
				color = child:GetAttribute("Color") or "ffffff",
				bot = child:GetAttribute("Bot") == true,
				operator = child:GetAttribute("Operator"),
			})
		end
		table.sort(items, function(a, b)
			if a.kills ~= b.kills then
				return a.kills > b.kills
			end
			return a.deaths < b.deaths
		end)
		return items
	end

	local function paintRows(parent, limit)
		for _, child in ipairs(parent:GetChildren()) do
			if child:IsA("TextLabel") then
				child:Destroy()
			end
		end
		local items = rows()
		local count = #items
		if limit then
			count = math.min(count, limit)
		end
		for index = 1, count do
			local item = items[index]
			local mine = player:GetAttribute("InMatch") and not item.bot and item.name == player.DisplayName
			label({
				parent = parent,
				text = string.format("%s    %d / %d", item.name, item.kills, item.deaths),
				font = mine and Enum.Font.GothamBold or Enum.Font.Gotham,
				textSize = 14,
				color = mine and THEME.orange or ColorUtil.hex(item.color),
				size = UDim2.new(1, 0, 0, 18),
			})
		end
	end

	function api.refresh(spread)
		local matchFolder = ReplicatedStorage:FindFirstChild("Match")
		local phase = matchFolder and matchFolder:GetAttribute("Phase") or "warmup"
		local inMatch = player:GetAttribute("InMatch") == true
		select.Visible = not inMatch
		deployGui.Enabled = not inMatch
		hud.Visible = inMatch
		fullBoard.Visible = inMatch and boardOpen
		local showResults = inMatch and phase == "results"
		results.Visible = showResults
		if not inMatch then
			local status = matchFolder and matchFolder:GetAttribute("Status") or ""
			local subLabel = select:FindFirstChild("Sub")
			if subLabel and subLabel:IsA("TextLabel") then
				subLabel.Text = "ROBLOX V1  ·  THE EXCHANGE  ·  " .. string.upper(status)
			end
		end
		if not inMatch then
			return
		end
		local timeLeft = matchFolder and matchFolder:GetAttribute("TimeLeft") or 0
		local fragLimit = matchFolder and matchFolder:GetAttribute("FragLimit") or 15
		if phase == "results" then
			local left = matchFolder and matchFolder:GetAttribute("Intermission") or 0
			top.Text = clockText(left)
			sub.Text = "NEXT ROUND"
			resultTitle.Text = matchFolder and matchFolder:GetAttribute("Winner") or "ROUND"
			resultBody.Text = (matchFolder and matchFolder:GetAttribute("Status") or "") .. "\nRematch starts automatically."
		else
			top.Text = clockText(timeLeft)
			sub.Text = "FIRST TO " .. tostring(fragLimit)
		end
		local humanoid = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
		local hp = humanoid and math.max(0, math.floor(humanoid.Health + 0.5)) or 0
		health.Text = tostring(hp)
		health.TextColor3 = hp < 35 and THEME.danger or THEME.teal
		armor.Text = "ARM " .. tostring(math.floor((player:GetAttribute("Armor") or 0) + 0.5))
		local weaponId = player:GetAttribute("Weapon") or "pulse"
		local weaponDef = Weapons.get(weaponId)
		weapon.Text = weaponDef and weaponDef.short or "PULSE"
		if weaponId == "pulse" then
			ammo.Text = "∞    1 PULSE  2 ROCKET  3 SCATTER"
		else
			local key = weaponId == "rocket" and "AmmoRocket" or "AmmoScatter"
			ammo.Text = tostring(player:GetAttribute(key) or 0) .. "    1 PULSE  2 ROCKET  3 SCATTER"
		end
		local remaining = player:GetAttribute("AbilityRemaining") or 0
		local abilityName = player:GetAttribute("AbilityName") or "ABILITY"
		if remaining > 0.05 then
			ability.Text = string.format("Q  %s  %0.1fs", string.upper(abilityName), remaining)
			ability.TextColor3 = THEME.muted
		else
			ability.Text = "Q  " .. string.upper(abilityName) .. "  READY"
			ability.TextColor3 = THEME.orange
		end
		local gap = 14 + (spread or 0) * 260
		hairL.Position = UDim2.new(0.5, -gap, 0.5, 0)
		hairR.Position = UDim2.new(0.5, gap, 0.5, 0)
		hairU.Position = UDim2.new(0.5, 0, 0.5, -gap)
		hairD.Position = UDim2.new(0.5, 0, 0.5, gap)
		if os.clock() >= nextRows then
			nextRows = os.clock() + 0.2
			paintRows(scoreList, 8)
			if boardOpen then
				paintRows(fullList, 12)
			end
		end
		hurtAlpha = math.max(0, hurtAlpha - 0.015)
		local low = 0
		if humanoid and humanoid.MaxHealth > 0 and humanoid.Health / humanoid.MaxHealth < 0.3 then
			low = 0.25 + math.sin(os.clock() * 6) * 0.08
		end
		local alpha = math.clamp(hurtAlpha + low, 0, 0.7)
		vignette.BackgroundTransparency = 1 - alpha * 0.35
		if vignetteStroke then
			vignetteStroke.Transparency = 1 - alpha
		end
	end

	function api.onFx(payload)
		if type(payload) ~= "table" then
			return
		end
		if payload.kind == "hurt" then
			hurtAlpha = math.clamp(hurtAlpha + 0.45, 0, 1)
		elseif payload.kind == "marker" then
			marker.Visible = true
			for _, child in ipairs(marker:GetChildren()) do
				if child:IsA("Frame") then
					child.BackgroundColor3 = payload.killed and THEME.danger or Color3.new(1, 1, 1)
				end
			end
			task.delay(0.12, function()
				marker.Visible = false
			end)
		elseif payload.kind == "feed" and type(payload.text) == "string" then
			table.insert(feedLines, payload.text)
			while #feedLines > 5 do
				table.remove(feedLines, 1)
			end
			for _, child in ipairs(feed:GetChildren()) do
				if child:IsA("TextLabel") then
					child:Destroy()
				end
			end
			for _, text in ipairs(feedLines) do
				label({
					parent = feed,
					text = text,
					font = Enum.Font.GothamBold,
					textSize = 13,
					color = THEME.text,
					size = UDim2.new(1, 0, 0, 16),
				})
			end
		elseif payload.kind == "float" and typeof(payload.position) == "Vector3" then
			local anchor = Instance.new("Part")
			anchor.Anchored = true
			anchor.CanCollide = false
			anchor.CanQuery = false
			anchor.Transparency = 1
			anchor.Size = Vector3.new(0.2, 0.2, 0.2)
			anchor.CFrame = CFrame.new(payload.position + Vector3.new(0, 2, 0))
			anchor.Parent = workspace
			local plate = Instance.new("BillboardGui")
			plate.Size = UDim2.fromOffset(60, 24)
			plate.AlwaysOnTop = true
			plate.Parent = anchor
			local text = label({
				parent = plate,
				text = payload.text or "",
				font = Enum.Font.GothamBold,
				textSize = 16,
				color = payload.color or THEME.text,
				align = Enum.TextXAlignment.Center,
			})
			task.spawn(function()
				for _ = 1, 10 do
					anchor.CFrame = anchor.CFrame + Vector3.new(0, 0.12, 0)
					text.TextTransparency = text.TextTransparency + 0.1
					task.wait(0.03)
				end
				anchor:Destroy()
			end)
		end
	end

	function api.selectedId()
		return selected
	end

	function api.selectIndex(index)
		local listOps = Operators.all()
		local operator = listOps[index]
		if operator then
			selected = operator.id
			Hud._paintCards()
		end
	end

	function api.toggleBoard(open)
		if open == nil then
			boardOpen = not boardOpen
		else
			boardOpen = open
		end
		nextRows = 0
	end

	local function emitDeploy()
		if onDeploy then
			onDeploy(selected)
		end
	end
	-- One connection. Click, touch, and gamepad all fire Activated.
	deploy.Activated:Connect(emitDeploy)
	again.MouseButton1Click:Connect(function()
		local folder = ReplicatedStorage:WaitForChild("Remotes")
		folder:WaitForChild("ChangeOperator"):FireServer()
	end)

	Hud._paintCards()
	api.refresh(0)
	return api, deploy
end

return Hud
