package maintenancejobs

import "time"

// SetTurnWait shortens how long a pass waits for another replica's pass, so a
// test of two replicas does not wait out passTurnWait.
func (j *Jobs) SetTurnWait(wait time.Duration) { j.turnWait = wait }
