using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Modules.Timers;
using System.Net.Http;
using System.Text;
using System.Text.Json;

namespace CS2LivePlugin;

public class CS2LivePlugin : BasePlugin
{
    public override string ModuleName => "CS2LivePlugin";
    public override string ModuleVersion => "1.0.0";
    public override string ModuleAuthor => "cs2-minimapa";

    private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
    private const string RAILWAY_URL = "https://nodejs-production-ab77.up.railway.app/gamestate";

    private Dictionary<ulong, PlayerData> _players = new();
    private int _team1Score = 0;
    private int _team2Score = 0;
    private int _round = 0;
    private string _phase = "aguardando";
    private string _map = "";

    public override void Load(bool hotReload)
    {
        _map = Server.MapName ?? "";
        RegisterEventHandler<EventRoundStart>(OnRoundStart);
        RegisterEventHandler<EventRoundEnd>(OnRoundEnd);
        RegisterEventHandler<EventPlayerDeath>(OnPlayerDeath);
        RegisterEventHandler<EventPlayerSpawn>(OnPlayerSpawn);
        RegisterEventHandler<EventCsWinPanelMatch>(OnMatchEnd);
        RegisterEventHandler<EventPlayerConnectFull>(OnPlayerConnect);
        RegisterEventHandler<EventPlayerDisconnect>(OnPlayerDisconnect);
        AddTimer(2.0f, SendState, TimerFlags.REPEAT);
        Console.WriteLine("[CS2Live] Plugin carregado!");
    }

    private HookResult OnRoundStart(EventRoundStart ev, GameEventInfo info)
    {
        _phase = "live";
        _map = Server.MapName ?? _map;
        _round++;
        return HookResult.Continue;
    }

    private HookResult OnRoundEnd(EventRoundEnd ev, GameEventInfo info)
    {
        _phase = "round_end";
        if (ev.Winner == 3) _team1Score++;
        else if (ev.Winner == 2) _team2Score++;
        return HookResult.Continue;
    }

    private HookResult OnPlayerDeath(EventPlayerDeath ev, GameEventInfo info)
    {
        var victim = ev.Userid;
        var attacker = ev.Attacker;
        if (victim != null && victim.IsValid && !victim.IsBot)
        {
            var sid = victim.SteamID;
            if (!_players.ContainsKey(sid)) _players[sid] = new PlayerData { Name = victim.PlayerName };
            _players[sid].Deaths++;
            _players[sid].Name = victim.PlayerName;
        }
        if (attacker != null && attacker.IsValid && !attacker.IsBot && attacker != victim)
        {
            var sid = attacker.SteamID;
            if (!_players.ContainsKey(sid)) _players[sid] = new PlayerData { Name = attacker.PlayerName };
            _players[sid].Kills++;
            _players[sid].Name = attacker.PlayerName;
        }
        if (ev.Assister != null && ev.Assister.IsValid && !ev.Assister.IsBot)
        {
            var sid = ev.Assister.SteamID;
            if (!_players.ContainsKey(sid)) _players[sid] = new PlayerData { Name = ev.Assister.PlayerName };
            _players[sid].Assists++;
        }
        return HookResult.Continue;
    }

    private HookResult OnPlayerSpawn(EventPlayerSpawn ev, GameEventInfo info)
    {
        var p = ev.Userid;
        if (p != null && p.IsValid && !p.IsBot)
        {
            var sid = p.SteamID;
            if (!_players.ContainsKey(sid)) _players[sid] = new PlayerData { Name = p.PlayerName };
        }
        return HookResult.Continue;
    }

    private HookResult OnMatchEnd(EventCsWinPanelMatch ev, GameEventInfo info)
    {
        _phase = "encerrado";
        return HookResult.Continue;
    }

    private HookResult OnPlayerConnect(EventPlayerConnectFull ev, GameEventInfo info)
    {
        var p = ev.Userid;
        if (p != null && p.IsValid && !p.IsBot)
        {
            var sid = p.SteamID;
            if (!_players.ContainsKey(sid)) _players[sid] = new PlayerData { Name = p.PlayerName };
        }
        return HookResult.Continue;
    }

    private HookResult OnPlayerDisconnect(EventPlayerDisconnect ev, GameEventInfo info)
    {
        var p = ev.Userid;
        if (p != null && p.IsValid && !p.IsBot) _players.Remove(p.SteamID);
        return HookResult.Continue;
    }

    private void SendState()
    {
        _map = Server.MapName ?? _map;
        var online = Utilities.GetPlayers().Where(p => p.IsValid && !p.IsBot && p.Connected == PlayerConnectedState.PlayerConnected);
        foreach (var p in online)
        {
            var sid = p.SteamID;
            if (!_players.ContainsKey(sid)) _players[sid] = new PlayerData { Name = p.PlayerName };
            else _players[sid].Name = p.PlayerName;
        }
        var payload = new
        {
            map = _map,
            phase = _phase,
            round = _round,
            team1 = new { name = "CT", score = _team1Score },
            team2 = new { name = "TR", score = _team2Score },
            players = _players.Values.OrderByDescending(p => p.Kills).Select(p => new {
                name = p.Name, kills = p.Kills, deaths = p.Deaths, assists = p.Assists
            })
        };
        var json = JsonSerializer.Serialize(payload);
        _ = Task.Run(async () =>
        {
            try
            {
                var content = new StringContent(json, Encoding.UTF8, "application/json");
                await Http.PostAsync(RAILWAY_URL, content);
            }
            catch { }
        });
    }
}

public class PlayerData
{
    public string Name { get; set; } = "";
    public int Kills { get; set; } = 0;
    public int Deaths { get; set; } = 0;
    public int Assists { get; set; } = 0;
}
