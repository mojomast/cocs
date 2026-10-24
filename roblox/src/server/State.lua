-- Shared server match state. Other server modules require this instead of each other.

local State = {
	phase = "warmup",
	timeLeft = 300,
	actors = {},
	byModel = {},
	byId = {},
	nextId = 1,
	remotes = nil,
	matchFolder = nil,
	roster = nil,
	geometry = nil,
	cosmetic = nil,
	pickups = {},
}

function State.actorForPlayer(player)
	for _, actor in ipairs(State.actors) do
		if actor.player == player then
			return actor
		end
	end
	return nil
end

function State.humanCount()
	local count = 0
	for _, actor in ipairs(State.actors) do
		if actor.player and actor.player.Parent and actor.player:GetAttribute("InMatch") then
			count = count + 1
		end
	end
	return count
end

function State.botCount()
	local count = 0
	for _, actor in ipairs(State.actors) do
		if not actor.player then
			count = count + 1
		end
	end
	return count
end

return State
