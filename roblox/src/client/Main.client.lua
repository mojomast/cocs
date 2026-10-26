-- Local input. Sends aim and buttons. Does not apply damage.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UserInputService = game:GetService("UserInputService")
local ContextActionService = game:GetService("ContextActionService")
local GuiService = game:GetService("GuiService")
local RunService = game:GetService("RunService")
local StarterGui = game:GetService("StarterGui")
local TextChatService = game:GetService("TextChatService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Weapons = require(Shared:WaitForChild("Weapons"))
local Hud = require(script.Parent.Hud)
local View = require(script.Parent.View)

local player = Players.LocalPlayer

local function safeCore(name, enabled)
	pcall(function()
		StarterGui:SetCoreGuiEnabled(name, enabled)
	end)
end

safeCore(Enum.CoreGuiType.Health, false)
safeCore(Enum.CoreGuiType.Backpack, false)
safeCore(Enum.CoreGuiType.PlayerList, false)

local remotesFolder = ReplicatedStorage:WaitForChild("Remotes")
ReplicatedStorage:WaitForChild("Match")
ReplicatedStorage:WaitForChild("Roster")
local remotes = {
	SelectOperator = remotesFolder:WaitForChild("SelectOperator"),
	FireWeapon = remotesFolder:WaitForChild("FireWeapon"),
	SwitchWeapon = remotesFolder:WaitForChild("SwitchWeapon"),
	SetSprint = remotesFolder:WaitForChild("SetSprint"),
	UseAbility = remotesFolder:WaitForChild("UseAbility"),
	ChangeOperator = remotesFolder:WaitForChild("ChangeOperator"),
	CombatFx = remotesFolder:WaitForChild("CombatFx"),
	Impulse = remotesFolder:WaitForChild("Impulse"),
}
local requestDeploy
local hud, deploy = Hud.mount(player, function(operatorId)
	requestDeploy(operatorId, "button")
end)
local view = View.start(player)
local sprinting = false

remotes.CombatFx.OnClientEvent:Connect(function(payload)
	hud.onFx(payload)
	view.onFx(payload)
end)

player.CharacterAdded:Connect(function()
	if sprinting and player:GetAttribute("InMatch") then
		remotes.SetSprint:FireServer(true)
	end
end)

remotes.Impulse.OnClientEvent:Connect(function(velocity)
	if typeof(velocity) ~= "Vector3" then
		return
	end
	local character = player.Character
	local hrp = character and character:FindFirstChild("HumanoidRootPart")
	if hrp then
		hrp.AssemblyLinearVelocity = hrp.AssemblyLinearVelocity + velocity
	end
end)

local holdingFire = false
local nextShot = 0
local slots = { [1] = "pulse", [2] = "rocket", [3] = "scatter" }

local function inMatch()
	return player:GetAttribute("InMatch") == true
end

local deployLock = false
requestDeploy = function(operatorId, source)
	local box = UserInputService:GetFocusedTextBox()
	print(
		"[COCS] Deploy attempt",
		source or "?",
		"id",
		operatorId,
		"inMatch",
		inMatch(),
		"lock",
		deployLock,
		"textBox",
		box and box:GetFullName() or "none"
	)
	if inMatch() then
		print("[COCS] Deploy bail: already in match")
		return
	end
	if deployLock then
		print("[COCS] Deploy bail: locked")
		return
	end
	if type(operatorId) ~= "string" or operatorId == "" then
		operatorId = hud.selectedId()
	end
	if type(operatorId) ~= "string" or operatorId == "" then
		operatorId = "chatgpt"
	end
	-- Look up the live instance. A remote cached at startup is dead if Rojo
	-- recreated ReplicatedStorage.Remotes during sync.
	local folder = ReplicatedStorage:FindFirstChild("Remotes")
	local remote = folder and folder:FindFirstChild("SelectOperator")
	if not remote or not remote:IsA("RemoteEvent") or remote.Parent == nil then
		warn("[COCS] Deploy bail: SelectOperator remote is missing")
		return
	end
	deployLock = true
	task.delay(0.4, function()
		deployLock = false
	end)
	print("[COCS] Deploy", operatorId)
	remote:FireServer(operatorId)
end

local function isDeployKey(key)
	return key == Enum.KeyCode.Return
		or key == Enum.KeyCode.KeypadEnter
		or key == Enum.KeyCode.E
		or key == Enum.KeyCode.Space
end

local function pointerOverDeploy()
	if not deploy or not deploy.Visible or not deploy.Parent then
		return false, nil
	end
	local location = UserInputService:GetMouseLocation()
	local hits = GuiService:GetGuiObjectsAtPosition(location.X, location.Y)
	local top = hits[1]
	for _, obj in ipairs(hits) do
		if obj == deploy or obj:IsDescendantOf(deploy) or obj.Name == "Deploy" then
			return true, top
		end
	end
	return false, top
end

local function sendWeapon(weaponId)
	if not inMatch() then
		return
	end
	remotes.SwitchWeapon:FireServer(weaponId)
end

local function tryFire()
	if not inMatch() or not holdingFire then
		return
	end
	local weaponId = player:GetAttribute("Weapon") or "pulse"
	local weapon = Weapons.get(weaponId)
	if not weapon then
		return
	end
	if os.clock() < nextShot then
		return
	end
	if weaponId == "rocket" and (player:GetAttribute("AmmoRocket") or 0) <= 0 then
		return
	end
	if weaponId == "scatter" and (player:GetAttribute("AmmoScatter") or 0) <= 0 then
		return
	end
	local look = workspace.CurrentCamera.CFrame.LookVector
	nextShot = os.clock() + weapon.interval
	remotes.FireWeapon:FireServer(weaponId, look)
	view.kick(weaponId)
	view.noteShot()
end

UserInputService.InputBegan:Connect(function(input, processed)
	if isDeployKey(input.KeyCode) then
		local box = UserInputService:GetFocusedTextBox()
		print(
			"[COCS] Key",
			input.KeyCode.Name,
			"processed",
			processed,
			"inMatch",
			inMatch(),
			"textBox",
			box and box.Name or "none"
		)
		if not inMatch() then
			requestDeploy(hud.selectedId(), input.KeyCode.Name)
			return
		end
	end
	if input.UserInputType == Enum.UserInputType.MouseButton1 then
		if not inMatch() then
			local over, top = pointerOverDeploy()
			local camera = workspace.CurrentCamera
			local height = camera and camera.ViewportSize.Y or 0
			local nearButton = height > 0 and UserInputService:GetMouseLocation().Y > height - 160
			if over or nearButton then
				print(
					"[COCS] Click",
					"processed",
					processed,
					"overDeploy",
					over,
					"top",
					top and top:GetFullName() or "none"
				)
			end
			if over then
				requestDeploy(hud.selectedId(), "click")
				return
			end
		end
		if processed then
			return
		end
		holdingFire = true
		tryFire()
		return
	end
	if processed and input.KeyCode ~= Enum.KeyCode.Tab then
		return
	end
	if input.KeyCode == Enum.KeyCode.LeftShift or input.KeyCode == Enum.KeyCode.RightShift then
		if inMatch() and not sprinting then
			sprinting = true
			remotes.SetSprint:FireServer(true)
		end
	elseif input.KeyCode == Enum.KeyCode.Q then
		if inMatch() then
			remotes.UseAbility:FireServer()
		end
	elseif input.KeyCode == Enum.KeyCode.Tab then
		hud.toggleBoard(true)
	elseif input.KeyCode == Enum.KeyCode.Backspace then
		if inMatch() then
			remotes.ChangeOperator:FireServer()
		end
	elseif input.KeyCode.Value >= Enum.KeyCode.One.Value and input.KeyCode.Value <= Enum.KeyCode.Nine.Value then
		local index = input.KeyCode.Value - Enum.KeyCode.One.Value + 1
		if inMatch() then
			local weaponId = slots[index]
			if weaponId then
				sendWeapon(weaponId)
			end
		else
			hud.selectIndex(index)
		end
	end
end)

UserInputService.InputEnded:Connect(function(input)
	if input.UserInputType == Enum.UserInputType.MouseButton1 then
		holdingFire = false
	elseif input.KeyCode == Enum.KeyCode.LeftShift or input.KeyCode == Enum.KeyCode.RightShift then
		if sprinting then
			sprinting = false
			remotes.SetSprint:FireServer(false)
		end
	elseif input.KeyCode == Enum.KeyCode.Tab then
		hud.toggleBoard(false)
	end
end)

UserInputService.InputChanged:Connect(function(input, processed)
	if processed or not inMatch() then
		return
	end
	if input.UserInputType == Enum.UserInputType.MouseWheel then
		local weaponId = player:GetAttribute("Weapon") or "pulse"
		local slot = 1
		if weaponId == "rocket" then
			slot = 2
		elseif weaponId == "scatter" then
			slot = 3
		end
		if input.Position.Z > 0 then
			slot = slot - 1
		else
			slot = slot + 1
		end
		if slot < 1 then
			slot = 3
		elseif slot > 3 then
			slot = 1
		end
		sendWeapon(slots[slot])
	end
end)

-- High priority so Studio chat cannot eat Enter before we see it.
-- E and Space deploy on the select screen. In a match they pass through (Space jumps).
ContextActionService:BindActionAtPriority("COCSDeploy", function(_, state, input)
	if state ~= Enum.UserInputState.Begin then
		return Enum.ContextActionResult.Pass
	end
	if not isDeployKey(input.KeyCode) then
		return Enum.ContextActionResult.Pass
	end
	if inMatch() then
		return Enum.ContextActionResult.Pass
	end
	requestDeploy(hud.selectedId(), "action:" .. input.KeyCode.Name)
	return Enum.ContextActionResult.Sink
end, false, 4000, Enum.KeyCode.Return, Enum.KeyCode.KeypadEnter, Enum.KeyCode.E, Enum.KeyCode.Space)

local chatWas = nil
local function setSelectChat(playing)
	if chatWas == playing then
		return
	end
	chatWas = playing
	safeCore(Enum.CoreGuiType.Chat, playing)
	pcall(function()
		local bar = TextChatService:FindFirstChildOfClass("ChatInputBarConfiguration")
		if bar then
			bar.Enabled = playing
		end
	end)
end

RunService.RenderStepped:Connect(function()
	if holdingFire then
		tryFire()
	end
	setSelectChat(inMatch())
	hud.refresh(view.spread())
end)

print("[COCS] Client input ready. Deploy with the button, Enter, E, or Space.")

-- deploy is returned so the button exists even if something else wants it.
if deploy then
	deploy.Visible = true
end
