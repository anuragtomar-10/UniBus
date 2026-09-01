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
-- KEYS[2] = user_hold_trip:{tripId}:{userId}
-- ARGV[1] = userId (the winner "owns" this key during the hold TTL)
-- ARGV[2] = TTL in seconds (~300 = 5 minutes)
--
-- Returns: 1 if hold was granted, 0 if already held by someone or user already holds a seat

local existingSeat = redis.call("GET", KEYS[1])
if existingSeat then return 0 end

local existingUserHold = redis.call("GET", KEYS[2])
if existingUserHold then return 0 end

redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
redis.call("SET", KEYS[2], ARGV[1], "EX", ARGV[2])
return 1
