local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Remotes = {}

local EVENT_NAMES = {
	"SelectOperator",
	"FireWeapon",
	"SwitchWeapon",
	"SetSprint",
	"UseAbility",
	"ChangeOperator",
	"CombatFx",
	"Impulse",
}

function Remotes.build()
	local folder = ReplicatedStorage:FindFirstChild("Remotes")
	if not folder then
		folder = Instance.new("Folder")
		folder.Name = "Remotes"
		folder.Parent = ReplicatedStorage
	end
	local events = {}
	for _, name in ipairs(EVENT_NAMES) do
		local event = folder:FindFirstChild(name)
		if not event then
			event = Instance.new("RemoteEvent")
			event.Name = name
			event.Parent = folder
		end
		events[name] = event
	end

	local matchFolder = ReplicatedStorage:FindFirstChild("Match")
	if not matchFolder then
		matchFolder = Instance.new("Folder")
		matchFolder.Name = "Match"
		matchFolder.Parent = ReplicatedStorage
	end
	matchFolder:SetAttribute("Phase", "warmup")
	matchFolder:SetAttribute("TimeLeft", 300)
	matchFolder:SetAttribute("FragLimit", 15)
	matchFolder:SetAttribute("MapName", "The Exchange")
	matchFolder:SetAttribute("Winner", "")
	matchFolder:SetAttribute("Tie", false)
	matchFolder:SetAttribute("Status", "Pick an operator. Bots are already in the pit.")

	local roster = ReplicatedStorage:FindFirstChild("Roster")
	if not roster then
		roster = Instance.new("Folder")
		roster.Name = "Roster"
		roster.Parent = ReplicatedStorage
	end

	return events, matchFolder, roster
end

return Remotes
