-- Local input. Sends aim and buttons. Does not apply damage.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UserInputService = game:GetService("UserInputService")
local RunService = game:GetService("RunService")
local StarterGui = game:GetService("StarterGui")

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
local hud, deploy = Hud.mount(player)
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
	if input.UserInputType == Enum.UserInputType.MouseButton1 then
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
	elseif input.KeyCode == Enum.KeyCode.Return or input.KeyCode == Enum.KeyCode.KeypadEnter then
		if not inMatch() then
			remotes.SelectOperator:FireServer(hud.selectedId())
		end
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

RunService.RenderStepped:Connect(function()
	if holdingFire then
		tryFire()
	end
	hud.refresh(view.spread())
end)

-- deploy is returned so the button exists even if something else wants it.
if deploy then
	deploy.Visible = true
end
