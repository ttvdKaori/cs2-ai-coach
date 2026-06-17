package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/golang/geo/r3"
	dem "github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs"
	"github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/common"
	"github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/events"
)

type output struct {
	Parser parserInfo `json:"parser"`
	Upload uploadInfo `json:"upload,omitempty"`
	Match  matchInfo  `json:"match"`
}

type parserInfo struct {
	Name string `json:"name"`
	Mode string `json:"mode"`
}

type uploadInfo struct {
	ID           string `json:"id,omitempty"`
	OriginalName string `json:"originalName,omitempty"`
	Size         int64  `json:"size,omitempty"`
	SHA256       string `json:"sha256,omitempty"`
}

type matchInfo struct {
	ID           string            `json:"id"`
	Map          string            `json:"map"`
	SupportedMap bool              `json:"supportedMap"`
	Score        scoreInfo         `json:"score"`
	Teams        []teamInfo        `json:"teams"`
	RoundsPlayed int               `json:"roundsPlayed"`
	DurationMins int               `json:"durationMinutes"`
	SideWinRates map[string]string `json:"sideWinRates"`
	Players      []playerInfo      `json:"players"`
	Rounds       []roundInfo       `json:"rounds"`
	Evidence     []evidenceInfo    `json:"evidence"`
	GeneratedAt  string            `json:"generatedAt"`
}

type scoreInfo struct {
	TeamA int `json:"team_a"`
	TeamB int `json:"team_b"`
}

type teamInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type playerInfo struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	TeamID      string         `json:"teamId"`
	SteamID     string         `json:"steamId"`
	Profile     string         `json:"profile"`
	SideStart   string         `json:"sideStart"`
	PathSummary []string       `json:"pathSummary"`
	Stats       map[string]any `json:"stats"`
}

type roundInfo struct {
	Number       int               `json:"number"`
	WinnerTeamID string            `json:"winnerTeamId"`
	WinningSide  string            `json:"winningSide"`
	SideByTeam   map[string]string `json:"sideByTeam"`
	ScoreBefore  scoreInfo         `json:"scoreBefore"`
	EconomyType  string            `json:"economyType"`
	Economy      map[string]int    `json:"economy"`
	Result       string            `json:"result"`
	EndReason    string            `json:"endReason"`
	Tags         []string          `json:"tags"`
	Events       []eventInfo       `json:"events"`
}

type eventInfo struct {
	ID               string   `json:"id"`
	Round            int      `json:"round"`
	Time             string   `json:"time"`
	Type             string   `json:"type"`
	PlayerID         string   `json:"playerId"`
	PlayerName       string   `json:"playerName"`
	TeamID           string   `json:"teamId"`
	Side             string   `json:"side"`
	Location         string   `json:"location"`
	Description      string   `json:"description"`
	RelatedPlayerIDs []string `json:"relatedPlayerIds"`
	Impact           string   `json:"impact"`
}

type evidenceInfo struct {
	ID          string  `json:"id"`
	PlayerID    string  `json:"playerId"`
	PlayerName  string  `json:"playerName"`
	TeamID      string  `json:"teamId"`
	Round       int     `json:"round"`
	Time        string  `json:"time"`
	Location    string  `json:"location"`
	Issue       string  `json:"issue"`
	Label       string  `json:"label"`
	Event       string  `json:"event"`
	Description string  `json:"description"`
	Side        string  `json:"side"`
	Severity    float64 `json:"severitySeed"`
}

type playerStats struct {
	name             string
	steamID          string
	teamID           string
	sideStart        string
	kills            int
	deaths           int
	assists          int
	damage           int
	openingAttempts  int
	openingWins      int
	firstDeaths      int
	tradeKills       int
	flashAssists     int
	utilityDamage    int
	enemiesFlashed   int
	teammatesFlashed int
	locationCounts   map[string]int
}

type parserState struct {
	parser       dem.Parser
	header       common.DemoHeader
	currentRound int
	score        scoreInfo
	rounds       []roundInfo
	roundIndex   map[int]int
	events       []eventInfo
	evidence     []evidenceInfo
	stats        map[uint64]*playerStats
	teams        map[string]string
	roundKills   map[int]int
}

func main() {
	log.SetOutput(os.Stderr)
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: demoparser <demo.dem>")
		os.Exit(2)
	}

	result, err := parse(os.Args[1])
	if err != nil {
		log.Fatal(err)
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(result); err != nil {
		log.Fatal(err)
	}
}

func parse(path string) (output, error) {
	f, err := os.Open(path)
	if err != nil {
		return output{}, err
	}
	defer f.Close()

	p := dem.NewParser(f)
	defer p.Close()

	header, err := p.ParseHeader()
	if err != nil {
		return output{}, err
	}

	state := &parserState{
		parser:       p,
		header:       header,
		currentRound: 0,
		roundIndex:   map[int]int{},
		stats:        map[uint64]*playerStats{},
		teams:        map[string]string{"team_a": "Team A", "team_b": "Team B"},
		roundKills:   map[int]int{},
	}
	registerHandlers(state)

	if err := p.ParseToEnd(); err != nil {
		return output{}, err
	}
	state.capturePlayers()
	state.finalizeRounds()

	players := state.players()
	score := state.score
	if score.TeamA == 0 && score.TeamB == 0 {
		score = scoreFromRounds(state.rounds)
	}

	return output{
		Parser: parserInfo{Name: "demoinfocs-golang-v4", Mode: "real-demo-parser"},
		Upload: uploadInfo{
			ID:           os.Getenv("CS2_DEMO_UPLOAD_ID"),
			OriginalName: os.Getenv("CS2_DEMO_ORIGINAL_NAME"),
			Size:         envInt64("CS2_DEMO_SIZE"),
			SHA256:       os.Getenv("CS2_DEMO_SHA256"),
		},
		Match: matchInfo{
			ID:           matchID(path, os.Getenv("CS2_DEMO_SHA256")),
			Map:          normalizeMap(header.MapName),
			SupportedMap: strings.Contains(strings.ToLower(header.MapName), "mirage"),
			Score:        score,
			Teams: []teamInfo{
				{ID: "team_a", Name: state.teams["team_a"]},
				{ID: "team_b", Name: state.teams["team_b"]},
			},
			RoundsPlayed: len(state.rounds),
			DurationMins: int(math.Round(header.PlaybackTime.Minutes())),
			SideWinRates: sideWinRates(state.rounds),
			Players:      players,
			Rounds:       state.rounds,
			Evidence:     state.evidence,
			GeneratedAt:  time.Now().UTC().Format(time.RFC3339),
		},
	}, nil
}

func registerHandlers(s *parserState) {
	s.parser.RegisterEventHandler(func(e events.RoundStart) {
		s.currentRound++
		number := s.currentRound
		s.capturePlayers()
		round := roundInfo{
			Number:       number,
			WinnerTeamID: "",
			WinningSide:  "",
			SideByTeam:   s.currentSideByTeam(),
			ScoreBefore:  s.score,
			EconomyType:  currentEconomyType(s.parser.GameState()),
			Economy:      currentEconomySnapshot(s.parser.GameState()),
			Result:       "in progress",
			EndReason:    "",
			Tags:         []string{},
			Events:       []eventInfo{},
		}
		s.roundIndex[number] = len(s.rounds)
		s.rounds = append(s.rounds, round)
	})

	s.parser.RegisterEventHandler(func(e events.RoundEnd) {
		number := s.ensureRound()
		winnerID := teamIDFromWinner(e.Winner, s.currentSideByTeam())
		if winnerID == "team_a" {
			s.score.TeamA++
		} else if winnerID == "team_b" {
			s.score.TeamB++
		}
		idx := s.roundIndex[number]
		round := &s.rounds[idx]
		round.WinnerTeamID = winnerID
		round.WinningSide = sideName(e.Winner)
		round.Result = fmt.Sprintf("%s win", winnerID)
		round.EndReason = roundEndReason(e.Reason)
		if hasTag(round.Tags, "opening_death_swing") {
			round.Tags = appendUnique(round.Tags, "key_round")
		}
	})

	s.parser.RegisterEventHandler(func(e events.Kill) {
		number := s.ensureRound()
		s.roundKills[number]++
		killerID, killerName, killerTeam := s.playerIdentity(e.Killer)
		victimID, victimName, victimTeam := s.playerIdentity(e.Victim)
		location := playerLocation(e.Victim)
		if location == "unknown" {
			location = playerLocation(e.Killer)
		}
		event := eventInfo{
			ID:               fmt.Sprintf("r%d_kill_%d", number, len(s.events)+1),
			Round:            number,
			Time:             roundTime(s.parser.CurrentTime()),
			Type:             "kill",
			PlayerID:         killerID,
			PlayerName:       killerName,
			TeamID:           killerTeam,
			Side:             sideFromPlayer(e.Killer),
			Location:         location,
			Description:      fmt.Sprintf("%s killed %s at %s", fallbackName(killerName, "Unknown"), fallbackName(victimName, "Unknown"), location),
			RelatedPlayerIDs: []string{victimID},
			Impact:           "kill",
		}
		s.addEvent(number, event)
		s.updateKillStats(e, s.roundKills[number] == 1)
		if s.roundKills[number] == 1 && e.Victim != nil {
			s.addEvidence(evidenceInfo{
				ID:          fmt.Sprintf("ev_r%d_first_death_%s", number, victimID),
				PlayerID:    victimID,
				PlayerName:  victimName,
				TeamID:      victimTeam,
				Round:       number,
				Time:        event.Time,
				Location:    location,
				Issue:       "solo_first_death",
				Label:       "默认阶段单走首死",
				Event:       "首死",
				Description: fmt.Sprintf("%s died first at %s. This real parser evidence should be reviewed for trade distance and support timing.", fallbackName(victimName, "Player"), location),
				Side:        sideFromPlayer(e.Victim),
				Severity:    0.8,
			})
			idx := s.roundIndex[number]
			s.rounds[idx].Tags = appendUnique(s.rounds[idx].Tags, "opening_death_swing")
		} else if e.Victim != nil {
			s.addEvidence(evidenceInfo{
				ID:          fmt.Sprintf("ev_r%d_trade_spacing_%s_%d", number, victimID, s.roundKills[number]),
				PlayerID:    victimID,
				PlayerName:  victimName,
				TeamID:      victimTeam,
				Round:       number,
				Time:        event.Time,
				Location:    location,
				Issue:       "trade_spacing_review",
				Label:       "可能无补枪距离",
				Event:       "死亡后交易窗口待核对",
				Description: fmt.Sprintf("%s died at %s. Review nearest teammate distance and whether a trade was available within 5 seconds.", fallbackName(victimName, "Player"), location),
				Side:        sideFromPlayer(e.Victim),
				Severity:    0.42,
			})
		}
	})

	s.parser.RegisterEventHandler(func(e events.PlayerHurt) {
		if e.Attacker == nil || e.Player == nil || e.Attacker.Team == e.Player.Team {
			return
		}
		st := s.ensureStats(e.Attacker)
		st.damage += e.HealthDamageTaken
		if isUtilityWeapon(e.Weapon, e.WeaponString) {
			st.utilityDamage += e.HealthDamageTaken
		}
	})

	s.parser.RegisterEventHandler(func(e events.SmokeStart) {
		s.addGrenadeEvent("smoke", "smoke started", e.GrenadeEvent)
	})
	s.parser.RegisterEventHandler(func(e events.SmokeExpired) {
		s.addGrenadeEvent("smoke", "smoke expired", e.GrenadeEvent)
	})
	s.parser.RegisterEventHandler(func(e events.FlashExplode) {
		s.addGrenadeEvent("flash", "flash exploded", e.GrenadeEvent)
	})
	s.parser.RegisterEventHandler(func(e events.HeExplode) {
		s.addGrenadeEvent("he", "HE exploded", e.GrenadeEvent)
	})
	s.parser.RegisterEventHandler(func(e events.FireGrenadeStart) {
		s.addGrenadeEvent("fire", "fire started", e.GrenadeEvent)
	})
	s.parser.RegisterEventHandler(func(e events.DecoyStart) {
		s.addGrenadeEvent("decoy", "decoy started", e.GrenadeEvent)
	})
	s.parser.RegisterEventHandler(func(e events.PlayerFlashed) {
		s.addFlashResult(e)
	})

	s.parser.RegisterEventHandler(func(e events.BombPlanted) {
		s.addBombEvent("c4", "bomb planted", e.Player, bombsiteName(e.Site))
	})
	s.parser.RegisterEventHandler(func(e events.BombDefused) {
		s.addBombEvent("c4", "bomb defused", e.Player, bombsiteName(e.Site))
	})
	s.parser.RegisterEventHandler(func(e events.BombExplode) {
		s.addBombEvent("c4", "bomb exploded", e.Player, bombsiteName(e.Site))
	})
}

func (s *parserState) ensureRound() int {
	if s.currentRound == 0 {
		s.currentRound = 1
		s.roundIndex[1] = 0
		s.rounds = append(s.rounds, roundInfo{
			Number:      1,
			SideByTeam:  s.currentSideByTeam(),
			ScoreBefore: s.score,
			EconomyType: currentEconomyType(s.parser.GameState()),
			Economy:     currentEconomySnapshot(s.parser.GameState()),
			Tags:        []string{},
			Events:      []eventInfo{},
		})
	}
	return s.currentRound
}

func (s *parserState) addEvent(roundNumber int, event eventInfo) {
	s.events = append(s.events, event)
	idx := s.roundIndex[roundNumber]
	s.rounds[idx].Events = append(s.rounds[idx].Events, event)
}

func (s *parserState) addEvidence(e evidenceInfo) {
	s.evidence = append(s.evidence, e)
	idx, ok := s.roundIndex[e.Round]
	if !ok {
		return
	}
	s.rounds[idx].Events = append(s.rounds[idx].Events, eventInfo{
		ID:               e.ID,
		Round:            e.Round,
		Time:             e.Time,
		Type:             "evidence",
		PlayerID:         e.PlayerID,
		PlayerName:       e.PlayerName,
		TeamID:           e.TeamID,
		Side:             e.Side,
		Location:         e.Location,
		Description:      e.Description,
		RelatedPlayerIDs: []string{e.PlayerID},
		Impact:           e.Issue,
	})
}

func (s *parserState) addBombEvent(kind string, description string, player *common.Player, site string) {
	number := s.ensureRound()
	playerID, playerName, teamID := s.playerIdentity(player)
	location := "site " + site
	event := eventInfo{
		ID:               fmt.Sprintf("r%d_bomb_%d", number, len(s.events)+1),
		Round:            number,
		Time:             roundTime(s.parser.CurrentTime()),
		Type:             kind,
		PlayerID:         playerID,
		PlayerName:       playerName,
		TeamID:           teamID,
		Side:             sideFromPlayer(player),
		Location:         location,
		Description:      fmt.Sprintf("%s by %s at %s", description, fallbackName(playerName, "unknown"), location),
		RelatedPlayerIDs: []string{},
		Impact:           "c4",
	}
	s.addEvent(number, event)
	if player != nil && strings.Contains(description, "planted") {
		s.addEvidence(evidenceInfo{
			ID:          fmt.Sprintf("ev_r%d_postplant_%s", number, playerID),
			PlayerID:    playerID,
			PlayerName:  playerName,
			TeamID:      teamID,
			Round:       number,
			Time:        event.Time,
			Location:    location,
			Issue:       "post_plant_overpeek",
			Label:       "下包后站位纪律",
			Event:       "C4 planted",
			Description: fmt.Sprintf("%s planted at %s. Review post-plant spacing and crossfire discipline from this real C4 event.", fallbackName(playerName, "Player"), location),
			Side:        sideFromPlayer(player),
			Severity:    0.62,
		})
	}
}

func (s *parserState) addGrenadeEvent(kind string, description string, grenade events.GrenadeEvent) {
	number := s.ensureRound()
	playerID, playerName, teamID := s.playerIdentity(grenade.Thrower)
	location := vectorLocation(grenade.Position)
	event := eventInfo{
		ID:               fmt.Sprintf("r%d_utility_%d", number, len(s.events)+1),
		Round:            number,
		Time:             roundTime(s.parser.CurrentTime()),
		Type:             "utility",
		PlayerID:         playerID,
		PlayerName:       playerName,
		TeamID:           teamID,
		Side:             sideFromPlayer(grenade.Thrower),
		Location:         location,
		Description:      fmt.Sprintf("%s by %s at %s", description, fallbackName(playerName, "unknown"), location),
		RelatedPlayerIDs: []string{},
		Impact:           kind,
	}
	s.addEvent(number, event)
}

func (s *parserState) addFlashResult(e events.PlayerFlashed) {
	if e.Attacker == nil || e.Player == nil {
		return
	}
	number := s.ensureRound()
	attackerID, attackerName, attackerTeam := s.playerIdentity(e.Attacker)
	playerID, playerName, _ := s.playerIdentity(e.Player)
	location := playerLocation(e.Player)
	duration := e.FlashDuration().Seconds()
	teamFlash := e.Attacker.Team == e.Player.Team
	st := s.ensureStats(e.Attacker)
	impact := "enemy_flashed"
	if teamFlash {
		st.teammatesFlashed++
		impact = "team_flash"
	} else {
		st.enemiesFlashed++
	}
	event := eventInfo{
		ID:               fmt.Sprintf("r%d_flash_%d", number, len(s.events)+1),
		Round:            number,
		Time:             roundTime(s.parser.CurrentTime()),
		Type:             "utility",
		PlayerID:         attackerID,
		PlayerName:       attackerName,
		TeamID:           attackerTeam,
		Side:             sideFromPlayer(e.Attacker),
		Location:         location,
		Description:      fmt.Sprintf("%s flashed %s for %.1fs at %s", fallbackName(attackerName, "Unknown"), fallbackName(playerName, "Unknown"), duration, location),
		RelatedPlayerIDs: []string{playerID},
		Impact:           impact,
	}
	s.addEvent(number, event)
	if teamFlash && duration >= 1.0 {
		s.addEvidence(evidenceInfo{
			ID:          fmt.Sprintf("ev_r%d_team_flash_%s_%s", number, attackerID, playerID),
			PlayerID:    attackerID,
			PlayerName:  attackerName,
			TeamID:      attackerTeam,
			Round:       number,
			Time:        event.Time,
			Location:    location,
			Issue:       "team_flash",
			Label:       "闪到队友",
			Event:       "team flash",
			Description: fmt.Sprintf("%s flashed teammate %s for %.1fs at %s.", fallbackName(attackerName, "Player"), fallbackName(playerName, "teammate"), duration, location),
			Side:        sideFromPlayer(e.Attacker),
			Severity:    0.68,
		})
	}
}

func (s *parserState) updateKillStats(e events.Kill, opening bool) {
	if e.Killer != nil {
		st := s.ensureStats(e.Killer)
		st.kills++
		if opening {
			st.openingAttempts++
			st.openingWins++
		}
	}
	if e.Victim != nil {
		st := s.ensureStats(e.Victim)
		st.deaths++
		if opening {
			st.firstDeaths++
		}
	}
	if e.Assister != nil {
		s.ensureStats(e.Assister).assists++
	}
}

func (s *parserState) ensureStats(p *common.Player) *playerStats {
	if p == nil {
		return &playerStats{}
	}
	st, ok := s.stats[p.SteamID64]
	if !ok {
		st = &playerStats{
			name:           p.Name,
			steamID:        fmt.Sprintf("%d", p.SteamID64),
			teamID:         teamIDForPlayer(p),
			sideStart:      sideFromPlayer(p),
			locationCounts: map[string]int{},
		}
		s.stats[p.SteamID64] = st
	}
	if p.Name != "" {
		st.name = p.Name
	}
	if location := playerLocation(p); location != "unknown" {
		st.locationCounts[location]++
	}
	return st
}

func (s *parserState) capturePlayers() {
	for _, p := range s.parser.GameState().Participants().All() {
		if p == nil || p.Team == common.TeamSpectators || p.Team == common.TeamUnassigned {
			continue
		}
		st := s.ensureStats(p)
		teamID := st.teamID
		if p.TeamState != nil && p.TeamState.ClanName() != "" {
			s.teams[teamID] = p.TeamState.ClanName()
		}
	}
}

func (s *parserState) players() []playerInfo {
	players := make([]playerInfo, 0, len(s.stats))
	for _, st := range s.stats {
		deaths := max(1, st.deaths)
		rounds := max(1, len(s.rounds))
		openingRate := ratio(st.openingWins, max(1, st.openingAttempts))
		firstDeathRate := ratio(st.firstDeaths, rounds)
		players = append(players, playerInfo{
			ID:          playerID(st.steamID),
			Name:        fallbackName(st.name, "Unknown"),
			TeamID:      st.teamID,
			SteamID:     st.steamID,
			Profile:     profileFromStats(st),
			SideStart:   st.sideStart,
			PathSummary: topLocations(st.locationCounts, 5),
			Stats: map[string]any{
				"kills":                st.kills,
				"deaths":               st.deaths,
				"assists":              st.assists,
				"kd":                   roundFloat(float64(st.kills)/float64(deaths), 2),
				"adr":                  int(math.Round(float64(st.damage) / float64(rounds))),
				"kast":                 "0%",
				"openingDuelWinRate":   percent(openingRate),
				"firstDeathRate":       percent(firstDeathRate),
				"firstKillRate":        percent(ratio(st.openingWins, rounds)),
				"tradeKillRate":        percent(ratio(st.tradeKills, rounds)),
				"tradedDeathRate":      "0%",
				"timeToTradeSeconds":   0,
				"clutchWinRate":        "0%",
				"utilityEffectiveness": percent(ratio(st.enemiesFlashed+st.utilityDamage, max(1, rounds*20))),
				"utilityDamage":        st.utilityDamage,
				"flashAssists":         st.flashAssists,
				"enemiesFlashed":       st.enemiesFlashed,
				"teammatesFlashed":     st.teammatesFlashed,
				"postPlantSurvival":    "0%",
				"repeatDeathPositions": 0,
				"siteHoldSuccess":      "0%",
				"rotateTimingSeconds":  0,
			},
		})
	}
	sort.Slice(players, func(i, j int) bool {
		if players[i].TeamID == players[j].TeamID {
			return players[i].Name < players[j].Name
		}
		return players[i].TeamID < players[j].TeamID
	})
	return players
}

func (s *parserState) finalizeRounds() {
	for i := range s.rounds {
		if s.rounds[i].WinnerTeamID == "" {
			s.rounds[i].WinnerTeamID = "team_a"
		}
		if s.rounds[i].WinningSide == "" {
			s.rounds[i].WinningSide = s.rounds[i].SideByTeam[s.rounds[i].WinnerTeamID]
		}
		if s.rounds[i].Result == "" || s.rounds[i].Result == "in progress" {
			s.rounds[i].Result = fmt.Sprintf("%s win", s.rounds[i].WinnerTeamID)
		}
		if s.rounds[i].EndReason == "" {
			s.rounds[i].EndReason = "unknown"
		}
		if s.rounds[i].Tags == nil {
			s.rounds[i].Tags = []string{}
		}
	}
}

func (s *parserState) currentSideByTeam() map[string]string {
	sideByTeam := map[string]string{
		"team_a": "unknown",
		"team_b": "unknown",
	}
	for _, p := range s.parser.GameState().Participants().Playing() {
		if p == nil {
			continue
		}
		st := s.ensureStats(p)
		side := sideFromPlayer(p)
		if st.teamID == "team_a" || st.teamID == "team_b" {
			sideByTeam[st.teamID] = side
		}
	}
	if sideByTeam["team_a"] == "unknown" && sideByTeam["team_b"] == "unknown" {
		sideByTeam["team_a"] = "T"
		sideByTeam["team_b"] = "CT"
	}
	if sideByTeam["team_a"] == "unknown" && sideByTeam["team_b"] == "T" {
		sideByTeam["team_a"] = "CT"
	}
	if sideByTeam["team_a"] == "unknown" && sideByTeam["team_b"] == "CT" {
		sideByTeam["team_a"] = "T"
	}
	if sideByTeam["team_b"] == "unknown" && sideByTeam["team_a"] == "T" {
		sideByTeam["team_b"] = "CT"
	}
	if sideByTeam["team_b"] == "unknown" && sideByTeam["team_a"] == "CT" {
		sideByTeam["team_b"] = "T"
	}
	return sideByTeam
}

func currentEconomyType(gs dem.GameState) string {
	t := gs.TeamTerrorists()
	ct := gs.TeamCounterTerrorists()
	if t == nil || ct == nil {
		return "unknown"
	}
	total := t.CurrentEquipmentValue() + ct.CurrentEquipmentValue()
	switch {
	case total < 12000:
		return "eco/low buy"
	case total < 30000:
		return "half buy"
	default:
		return "full buy"
	}
}

func currentEconomySnapshot(gs dem.GameState) map[string]int {
	snapshot := map[string]int{
		"team_a": 0,
		"team_b": 0,
	}
	for _, p := range gs.Participants().Playing() {
		if p == nil {
			continue
		}
		snapshot[teamIDForPlayer(p)] += p.EquipmentValueCurrent()
	}
	return snapshot
}

func teamIDFromWinner(team common.Team, sideByTeam map[string]string) string {
	side := sideName(team)
	for teamID, teamSide := range sideByTeam {
		if teamSide == side {
			return teamID
		}
	}
	return "team_a"
}

func teamIDForPlayer(p *common.Player) string {
	if p == nil {
		return ""
	}
	if p.Team == common.TeamTerrorists {
		return "team_a"
	}
	if p.Team == common.TeamCounterTerrorists {
		return "team_b"
	}
	return "unknown"
}

func sideName(team common.Team) string {
	switch team {
	case common.TeamTerrorists:
		return "T"
	case common.TeamCounterTerrorists:
		return "CT"
	default:
		return "unknown"
	}
}

func sideFromPlayer(p *common.Player) string {
	if p == nil {
		return "unknown"
	}
	return sideName(p.Team)
}

func (s *parserState) playerIdentity(p *common.Player) (string, string, string) {
	if p == nil {
		return "unknown", "Unknown", "unknown"
	}
	return playerID(fmt.Sprintf("%d", p.SteamID64)), fallbackName(p.Name, "Unknown"), s.ensureStats(p).teamID
}

func playerID(steamID string) string {
	if steamID == "" || steamID == "0" {
		return "p_unknown"
	}
	return "steam_" + steamID
}

func playerLocation(p *common.Player) string {
	if p == nil {
		return "unknown"
	}
	if place := p.LastPlaceName(); place != "" {
		return place
	}
	pos := p.LastAlivePosition
	if pos.X != 0 || pos.Y != 0 || pos.Z != 0 {
		return fmt.Sprintf("%.0f,%.0f,%.0f", pos.X, pos.Y, pos.Z)
	}
	return "unknown"
}

func vectorLocation(v r3.Vector) string {
	if v.X == 0 && v.Y == 0 && v.Z == 0 {
		return "unknown"
	}
	return fmt.Sprintf("%.0f,%.0f,%.0f", v.X, v.Y, v.Z)
}

func isUtilityWeapon(weapon *common.Equipment, weaponString string) bool {
	value := strings.ToLower(weaponString)
	if weapon != nil {
		value += " " + strings.ToLower(weapon.String())
	}
	return strings.Contains(value, "hegrenade") ||
		strings.Contains(value, "grenade") ||
		strings.Contains(value, "molotov") ||
		strings.Contains(value, "incendiary") ||
		strings.Contains(value, "flash") ||
		strings.Contains(value, "smoke")
}

func roundTime(t time.Duration) string {
	total := int(t.Seconds())
	if total < 0 {
		total = 0
	}
	return fmt.Sprintf("%d:%02d", total/60, total%60)
}

func normalizeMap(name string) string {
	lower := strings.ToLower(name)
	if strings.Contains(lower, "mirage") {
		return "Mirage"
	}
	if name == "" {
		return "unknown"
	}
	return name
}

func matchID(path string, sha string) string {
	if sha != "" {
		if len(sha) > 12 {
			sha = sha[:12]
		}
		return "match_" + sha
	}
	base := strings.TrimSuffix(strings.ReplaceAll(path, string(os.PathSeparator), "_"), ".dem")
	return "match_" + base
}

func scoreFromRounds(rounds []roundInfo) scoreInfo {
	score := scoreInfo{}
	for _, r := range rounds {
		if r.WinnerTeamID == "team_a" {
			score.TeamA++
		} else if r.WinnerTeamID == "team_b" {
			score.TeamB++
		}
	}
	return score
}

func sideWinRates(rounds []roundInfo) map[string]string {
	wins := map[string]int{"T": 0, "CT": 0}
	played := map[string]int{"T": 0, "CT": 0}
	for _, r := range rounds {
		for _, side := range r.SideByTeam {
			if side == "T" || side == "CT" {
				played[side]++
			}
		}
		if r.WinningSide == "T" || r.WinningSide == "CT" {
			wins[r.WinningSide]++
		}
	}
	return map[string]string{
		"T":  percent(ratio(wins["T"], max(1, played["T"]))),
		"CT": percent(ratio(wins["CT"], max(1, played["CT"]))),
	}
}

func profileFromStats(st *playerStats) string {
	switch {
	case st.openingAttempts >= 4:
		return "aggressive opener"
	case st.utilityDamage > 100:
		return "utility support"
	case st.deaths < st.kills:
		return "site anchor"
	default:
		return "late round caller"
	}
}

func topLocations(counts map[string]int, limit int) []string {
	type item struct {
		location string
		count    int
	}
	items := make([]item, 0, len(counts))
	for location, count := range counts {
		items = append(items, item{location: location, count: count})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].count == items[j].count {
			return items[i].location < items[j].location
		}
		return items[i].count > items[j].count
	})
	out := []string{}
	for i, item := range items {
		if i >= limit {
			break
		}
		out = append(out, item.location)
	}
	return out
}

func roundEndReason(reason events.RoundEndReason) string {
	switch reason {
	case events.RoundEndReasonTargetBombed:
		return "bomb exploded"
	case events.RoundEndReasonBombDefused:
		return "bomb defused"
	case events.RoundEndReasonCTWin:
		return "ct win"
	case events.RoundEndReasonTerroristsWin:
		return "terrorists win"
	case events.RoundEndReasonTargetSaved:
		return "time expired"
	case events.RoundEndReasonDraw:
		return "draw"
	default:
		return fmt.Sprintf("reason_%d", reason)
	}
}

func bombsiteName(site events.Bombsite) string {
	switch site {
	case events.BombsiteA:
		return "A"
	case events.BombsiteB:
		return "B"
	default:
		return "unknown"
	}
}

func percent(v float64) string {
	return fmt.Sprintf("%.0f%%", v*100)
}

func ratio(a int, b int) float64 {
	if b <= 0 {
		return 0
	}
	return float64(a) / float64(b)
}

func roundFloat(v float64, places int) float64 {
	pow := math.Pow10(places)
	return math.Round(v*pow) / pow
}

func envInt64(name string) int64 {
	var v int64
	fmt.Sscanf(os.Getenv(name), "%d", &v)
	return v
}

func fallbackName(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func appendUnique(items []string, value string) []string {
	if hasTag(items, value) {
		return items
	}
	return append(items, value)
}

func hasTag(items []string, value string) bool {
	for _, item := range items {
		if item == value {
			return true
		}
	}
	return false
}

func max(a int, b int) int {
	if a > b {
		return a
	}
	return b
}
