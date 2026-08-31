-- Atomic seat hold via Lua script (NFR2, LLD §1)
--
-- Why Lua over plain Redis GET/SET:
--   A plain GET-then-SET is NOT atomic. Two simultaneous hold requests can both
--   pass the GET (key not set) before either finishes the SET — classic TOCTOU.
--   A Lua script runs as a single uninterruptible Redis operation, so exactly
--   one concurrent caller wins and the other gets a 0 return. This makes
--   check-and-set genuinely atomic and race-condition-safe (NFR2).
--
-- KEYS[1] = seat:{tripId}:{seatNumber}
-- ARGV[1] = userId (the winner "owns" this key during the hold TTL)
-- ARGV[2] = TTL in seconds (~300 = 5 minutes)
--
-- Returns: 1 if hold was granted (key was not set), 0 if already held by someone

local existing = redis.call("GET", KEYS[1])
if existing then return 0 end
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
return 1
