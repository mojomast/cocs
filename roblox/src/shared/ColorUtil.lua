-- Hex helpers. Color3 is only touched when a function runs, so the module loads outside Studio.

local ColorUtil = {}

function ColorUtil.hex(hex)
	hex = string.gsub(hex, "#", "")
	local r = tonumber(string.sub(hex, 1, 2), 16) or 0
	local g = tonumber(string.sub(hex, 3, 4), 16) or 0
	local b = tonumber(string.sub(hex, 5, 6), 16) or 0
	return Color3.fromRGB(r, g, b)
end

function ColorUtil.darken(color, amount)
	return color:Lerp(Color3.new(0, 0, 0), amount)
end

return ColorUtil
