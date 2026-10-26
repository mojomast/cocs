-- Boots the Exchange. CharacterAutoLoads is off so nobody spawns until they pick an operator.

local Players = game:GetService("Players")

Players.CharacterAutoLoads = false

local Remotes = require(script.Parent.Remotes)
local ArenaBuilder = require(script.Parent.ArenaBuilder)
local State = require(script.Parent.State)
local Pickups = require(script.Parent.Pickups)
local Match = require(script.Parent.Match)

local events, matchFolder, roster = Remotes.build()
State.remotes = events
State.matchFolder = matchFolder
State.roster = roster

ArenaBuilder.lighting()
local arena = workspace:FindFirstChild("Arena")
if not arena then
	arena = Instance.new("Folder")
	arena.Name = "Arena"
	arena.Parent = workspace
end
local geometry, cosmetic = ArenaBuilder.build(arena)
State.geometry = geometry
State.cosmetic = cosmetic
Pickups.build()

Match.start()
