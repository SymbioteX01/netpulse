/*!
 * NetPulse root-cause engine.
 * UMD: `window.NetFaultAnalyzer` in the browser, `module.exports` in Node.
 * Public API kept for the old UI: analyze(data), pctToDbm(pct), SEV_ORDER.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NetFaultAnalyzer = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SEV_ORDER = { 'Critical': 4, 'High': 3, 'Medium': 2, 'Low': 1, 'Healthy': 0 };
  const LAYERS = {
    1: { name: 'Physical', label: 'Layer 1 - Physical' },
    2: { name: 'Data Link', label: 'Layer 2 - Data Link' },
    3: { name: 'Network', label: 'Layer 3 - Network' },
    4: { name: 'Transport', label: 'Layer 4 - Transport' },
    7: { name: 'Application', label: 'Layer 7 - Application' }
  };
  const JITTER_THRESHOLD_MS = 60;

  function isActionable(sev) { return (SEV_ORDER[sev] || 0) >= 2; }

  // Windows maps the adapter RSSI onto a 0-100 "signal quality" scale; the
  // dBm value below is an ESTIMATE (see HANDOFF/API notes) not a measurement.
  function pctToDbmNumber(pct) {
    const n = typeof pct === 'number' ? pct : Number(pct);
    if (!isFinite(n)) return null;
    return Math.round((-50 - (100 - n) * 0.4) * 10) / 10;
  }
  function pctToDbm(pct) {
    const dbm = pctToDbmNumber(pct);
    return dbm === null ? 'n/a' : Math.round(dbm) + ' dBm (approx)';
  }

  function F(o) {
    return {
      id: o.id,
      title: o.title,
      rootCause: o.rootCause,
      layerNum: o.layerNum,
      layer: LAYERS[o.layerNum] || null,
      severity: o.severity,
      confidence: o.confidence,
      evidence: o.evidence,
      fix: o.fix,
      evidenceRefs: o.evidenceRefs || [],
      disproveIf: o.disproveIf || ''
    };
  }

  function pingVariation(p) {
    if (!p) return 0;
    if (typeof p.rttRange === 'number') return p.rttRange;
    if (typeof p.jitter === 'number') return p.jitter;
    return 0;
  }

  function insufficient(dataQuality) {
    return {
      findings: [],
      osiLayer: null,
      healthScore: null,
      status: 'Insufficient Data',
      headline: 'Insufficient data to diagnose',
      topFindingId: 'insufficient-data',
      contradictions: [],
      unusedEvidence: [],
      insufficientData: true,
      dataQuality: dataQuality || {},
      generatedAt: new Date().toISOString()
    };
  }

  function analyze(data) {
    data = data || {};
    const findings = [];
    const contradictions = [];
    const unusedEvidence = [];
    const mode = data.mode || 'wifi';
    const dq = data.dataQuality || {};
    const locBlocked = !!dq.locationPermissionBlocked;
    const conn = data.connectivity || {};
    const pings = conn.pings || {};
    const pGateway = pings.gateway || null;
    const pInternet = pings.internet || null;
    const pAlt = pings.alt || null;
    const wifi = data.wifi || {};
    const wifiUsable = !locBlocked;
    const wifiConnected = !!wifi.connected;
    const hasWiFi = !!wifi.available;
    const wd = wifi.data || null;
    const wifiSignal = wd && typeof wd.signalPct === 'number' ? wd.signalPct : null;
    const activeIface = conn.activeIface || null;
    const dns = data.dns || {};
    const trace = data.trace || { hops: [] };
    const hops = Array.isArray(trace.hops) ? trace.hops : [];
    const hasGateway = !!(conn.hasGateway || conn.gateway);
    const interfaces = Array.isArray(data.interfaces) ? data.interfaces : [];

    // ---- Insufficient data guard -------------------------------------------
    // Never turn a collector failure or a total absence of evidence into a fault.
    const pingVals = [pGateway, pInternet, pAlt].filter(Boolean);
    const totalSent = pingVals.reduce((a, p) => a + (p.sent || 0), 0);
    const coreFailed = Array.isArray(dq.coreCommandsFailed) ? dq.coreCommandsFailed : [];
    if (coreFailed.length > 0 || (totalSent === 0 && !hasGateway)) {
      return insufficient(dq);
    }

    // ---- Contradiction detection -------------------------------------------
    if (pGateway && pGateway.lossPct >= 90 && conn.internetReachable === true) {
      contradictions.push('Gateway shows ~100% loss but the internet is reported reachable.');
    }
    if (activeIface && activeIface.apipa && conn.gatewayReachable === true) {
      contradictions.push('APIPA address assigned but the gateway is reported reachable.');
    }
    if (conn.internetReachable === true && pInternet && pInternet.received === 0) {
      contradictions.push('internetReachable is true but no internet ping replied.');
    }

    // ---- Wi-Fi data unavailable (Location permission) -----------------------
    if (locBlocked) {
      findings.push(F({
        id: 'location-permission-blocked',
        title: 'Wi-Fi Data Unavailable (Location Permission)',
        rootCause: 'Windows refused `netsh wlan` because Location permission is off, so Wi-Fi signal/SSID could not be read. This is NOT a Wi-Fi fault.',
        layerNum: 2, severity: 'Low', confidence: 95,
        evidence: 'netsh wlan: "Network shell commands need location permission to access WLAN information"',
        fix: 'Settings > Privacy & security > Location: allow Location for desktop apps, then re-scan.',
        evidenceRefs: [{ source: 'dataQuality.locationPermissionBlocked', key: 'locationPermissionBlocked', value: true }],
        disproveIf: 'netsh wlan returns an interface list without the Location-permission message.'
      }));
    }
    if (Array.isArray(dq.warnings) && dq.warnings.length) {
      findings.push(F({
        id: 'collector-warning',
        title: 'Collector Warning',
        rootCause: 'One or more diagnostic collectors reported problems; results may be incomplete.',
        layerNum: 2, severity: 'Low', confidence: 70,
        evidence: dq.warnings.join(' | '),
        fix: 'Review dataQuality.commands in the scan for the failing collector.',
        evidenceRefs: [{ source: 'dataQuality.warnings', key: 'warnings', value: dq.warnings }],
        disproveIf: 'dataQuality.warnings is empty for a fresh scan.'
      }));
    }

    // ---- Mobile / no service ------------------------------------------------
    if (mode === 'mobile' && !conn.hasGateway && !wifiConnected && !(activeIface && activeIface.ipv4)) {
      findings.push(F({
        id: 'cellular-outage',
        title: 'Cellular Outage / No Service',
        rootCause: 'No cellular network is available - the cell tower is down or there is a SIM/network registration issue',
        layerNum: 1, severity: 'Critical', confidence: 90,
        evidence: 'No data session, no carrier gateway reachable',
        fix: 'Toggle airplane mode, re-insert the SIM card, and check the carrier network status',
        evidenceRefs: [
          { source: 'mode', key: 'mode', value: 'mobile' },
          { source: 'connectivity.hasGateway', key: 'hasGateway', value: !!conn.hasGateway }
        ],
        disproveIf: 'A carrier gateway or a data-session IPv4 address appears in the scan.'
      }));
    }

    // ---- No active interface (non-mobile only) ------------------------------
    if (mode !== 'mobile' && wifiUsable && !hasWiFi && !wifiConnected && !hasGateway && !(activeIface && activeIface.ipv4)) {
      findings.push(F({
        id: 'no-interface',
        title: 'No Network Interface Active',
        rootCause: 'No active network interface found - the WiFi adapter is off, the LAN cable is disconnected, or Wi-Fi data is unavailable',
        layerNum: 2, severity: 'Critical', confidence: 92,
        evidence: 'ipconfig: no IPv4 address assigned, no default gateway',
        fix: 'Enable the WiFi adapter or connect the LAN cable, then reboot and try again',
        evidenceRefs: [
          { source: 'connectivity.hasGateway', key: 'hasGateway', value: false },
          { source: 'connectivity.activeIface', key: 'ipv4', value: activeIface ? activeIface.ipv4 : null }
        ],
        disproveIf: 'Any interface shows an IPv4 address or a default gateway.'
      }));
    }

    // ---- APIPA DHCP failure -------------------------------------------------
    if (activeIface && activeIface.apipa) {
      findings.push(F({
        id: 'dhcp-unreachable',
        title: 'DHCP Server Unreachable (APIPA)',
        rootCause: 'Could not obtain an IP address from the DHCP server - the system auto-assigned APIPA 169.254.x.x',
        layerNum: 3, severity: 'Critical', confidence: 95,
        evidence: 'IPv4 = ' + activeIface.ipv4 + ' (169.254 APIPA range), no gateway',
        fix: 'Restart the router/AP, check the DHCP service, or assign a static IP and test',
        evidenceRefs: [
          { source: 'connectivity.activeIface.ipv4', key: 'ipv4', value: activeIface.ipv4 },
          { source: 'connectivity.activeIface.apipa', key: 'apipa', value: true }
        ],
        disproveIf: 'The interface obtains a non-APIPA (non 169.254.x.x) IPv4 address.'
      }));
    }

    // ---- Wi-Fi connection failed -------------------------------------------
    if (wifiUsable && hasWiFi && !wifiConnected && !(activeIface && activeIface.ipv4)) {
      findings.push(F({
        id: 'wifi-connection-failed',
        title: 'WiFi Connection Failed',
        rootCause: 'The WiFi adapter is active but not connecting to the network - wrong password/authentication or AP range issue',
        layerNum: 2, severity: 'High', confidence: 82,
        evidence: 'netsh wlan: state != connected',
        fix: 'Verify the password, forget the network and reconnect, or check the WPA2 configuration on the router',
        evidenceRefs: [
          { source: 'wifi.available', key: 'available', value: true },
          { source: 'wifi.connected', key: 'connected', value: false }
        ],
        disproveIf: 'netsh wlan reports state = connected.'
      }));
    }

    // ---- Wi-Fi signal strength ---------------------------------------------
    if (wifiConnected && wifiSignal !== null) {
      const sigEv = 'Signal = ' + wifiSignal + '% (' + pctToDbm(wifiSignal) + ')' +
        (data.meta && data.meta.signalLabel ? ' [' + data.meta.signalLabel + ']' : '');
      const sigRef = { source: 'wifi.data.signalPct', key: 'signalPct', value: wifiSignal };
      if (wifiSignal < 25) {
        findings.push(F({
          id: 'critical-weak-signal',
          title: 'Critical Weak Signal',
          rootCause: 'WiFi signal is too weak (<25%) - router is too far away or there is an antenna/RF issue',
          layerNum: 2, severity: 'Critical', confidence: 90,
          evidence: sigEv, fix: 'Move closer to the router, establish line-of-sight, or add a WiFi extender/AP',
          evidenceRefs: [sigRef],
          disproveIf: 'Signal quality rises to >=25%.'
        }));
      } else if (wifiSignal < 50) {
        findings.push(F({
          id: 'weak-signal',
          title: 'Weak Signal',
          rootCause: 'WiFi signal is weak (25-50%) - latency and packet loss may increase due to range or interference',
          layerNum: 2, severity: 'Medium', confidence: 88,
          evidence: sigEv, fix: 'Adjust the router position, remove walls/obstacles, or use a better antenna',
          evidenceRefs: [sigRef],
          disproveIf: 'Signal quality rises to >=50%.'
        }));
      }
    }

    // ---- Wi-Fi interference (uses RTT spread, i.e. rttRange) ----------------
    const jitterMax = Math.max(pingVariation(pInternet), pingVariation(pAlt));
    const jitterMetric = (pInternet && typeof pInternet.rttRange === 'number') || (pAlt && typeof pAlt.rttRange === 'number')
      ? 'rttRange' : 'jitter';
    if (mode === 'wifi' && wifiConnected && wifiSignal !== null && wifiSignal >= 50 && jitterMax > JITTER_THRESHOLD_MS) {
      findings.push(F({
        id: 'wifi-interference',
        title: 'WiFi Interference / Channel Congestion',
        rootCause: 'Signal is strong but RTT variation is very high - co-channel interference or WiFi channel congestion (802.11 CSMA/CA)',
        layerNum: 2, severity: 'High', confidence: Math.min(92, 60 + jitterMax * 0.5),
        evidence: 'Signal = ' + wifiSignal + '% (' + pctToDbm(wifiSignal) + '), RTT variation (' + jitterMetric + ') = ' + jitterMax + ' ms',
        fix: 'Change the router channel (try 1/6/11), use the 5 GHz band, or move away from neighboring APs',
        evidenceRefs: [
          { source: 'wifi.data.signalPct', key: 'signalPct', value: wifiSignal },
          { source: 'connectivity.pings.internet.' + jitterMetric, key: jitterMetric, value: jitterMax }
        ],
        disproveIf: 'RTT variation drops below ' + JITTER_THRESHOLD_MS + ' ms with a strong signal.'
      }));
    }

    // ---- Gateway link / stability ------------------------------------------
    if (pGateway && pGateway.lossPct >= 90) {
      findings.push(F({
        id: 'gateway-link-down',
        title: 'Gateway Link Down',
        rootCause: pGateway.lossPct + '% packet loss to the default gateway - the physical link or the router interface is down',
        layerNum: 1, severity: 'Critical', confidence: 94,
        evidence: 'ping ' + conn.gateway + ': loss = ' + pGateway.lossPct + '%, received = ' + pGateway.received + '/' + pGateway.sent,
        fix: 'Check the cable/port, restart the router, or toggle the interface up/down',
        evidenceRefs: [
          { source: 'connectivity.pings.gateway.lossPct', key: 'lossPct', value: pGateway.lossPct },
          { source: 'connectivity.gateway', key: 'gateway', value: conn.gateway || null }
        ],
        disproveIf: 'Any ping to the default gateway succeeds.'
      }));
    } else if (pGateway && pGateway.lossPct >= 40) {
      findings.push(F({
        id: 'gateway-unstable',
        title: 'Gateway Unstable (possible duplex mismatch or bad cable)',
        rootCause: '40%+ packets are dropped to the gateway - a bad cable, duplex/auto-negotiation mismatch, or router overload (duplex itself is NOT measured)',
        layerNum: 2, severity: 'High', confidence: 85,
        evidence: 'ping ' + conn.gateway + ': loss = ' + pGateway.lossPct + '%, RTT variation = ' + pingVariation(pGateway) + ' ms',
        fix: 'Replace the Ethernet cable, update the NIC drivers, and check duplex/auto-negotiation',
        evidenceRefs: [
          { source: 'connectivity.pings.gateway.lossPct', key: 'lossPct', value: pGateway.lossPct }
        ],
        disproveIf: 'Gateway packet loss falls below 40%.'
      }));
    }

    // ---- Internet reachability ---------------------------------------------
    if (conn.gatewayReachable === true && conn.internetReachable === false) {
      findings.push(F({
        id: 'internet-unreachable',
        title: 'Internet Unreachable (ISP / WAN Issue)',
        rootCause: 'Gateway is reachable locally but the internet (8.8.8.8) is unreachable - ISP link is down or the router WAN/PPPoE config is wrong',
        layerNum: 3, severity: 'Critical', confidence: 90,
        evidence: 'Gateway ping OK, ping 8.8.8.8 = 100% loss',
        fix: 'Check the router WAN status, contact the ISP, and restart the modem (30s power cycle)',
        evidenceRefs: [
          { source: 'connectivity.gatewayReachable', key: 'gatewayReachable', value: true },
          { source: 'connectivity.internetReachable', key: 'internetReachable', value: false }
        ],
        disproveIf: 'A ping to 8.8.8.8 receives at least one reply.'
      }));
    }

    // ---- Congestion / degradation ------------------------------------------
    if (pInternet && pInternet.lossPct > 0 && pInternet.lossPct <= 40 && pInternet.avg > 150) {
      findings.push(F({
        id: 'network-congestion',
        title: 'Network Congestion',
        rootCause: 'Moderate loss + high RTT - the link is congested and its buffers are overflowing',
        layerNum: 3, severity: 'Medium', confidence: Math.min(85, 55 + pInternet.lossPct),
        evidence: 'loss = ' + pInternet.lossPct + '%, avg RTT = ' + pInternet.avg + ' ms',
        fix: 'Retry during off-peak hours, stop bandwidth-heavy apps, or upgrade the bandwidth plan',
        evidenceRefs: [
          { source: 'connectivity.pings.internet.lossPct', key: 'lossPct', value: pInternet.lossPct },
          { source: 'connectivity.pings.internet.avg', key: 'avg', value: pInternet.avg }
        ],
        disproveIf: 'Internet loss <1% and average RTT <150 ms.'
      }));
    }
    if (pInternet && pInternet.lossPct > 40 && pInternet.lossPct < 90) {
      findings.push(F({
        id: 'severe-degradation',
        title: 'Severe Link Degradation',
        rootCause: '40%+ packet loss on the internet path - severe congestion, interference, or an ISP line issue',
        layerNum: 3, severity: 'High', confidence: 85,
        evidence: 'loss = ' + pInternet.lossPct + '%, RTT variation = ' + pingVariation(pInternet) + ' ms',
        fix: 'Get an ISP line test done, and eliminate WiFi interference (test with a wired connection)',
        evidenceRefs: [{ source: 'connectivity.pings.internet.lossPct', key: 'lossPct', value: pInternet.lossPct }],
        disproveIf: 'Internet packet loss falls below 40%.'
      }));
    }
    const avgBoth = [pInternet && pInternet.avg, pAlt && pAlt.avg].filter(v => typeof v === 'number');
    const lowLoss = (pInternet ? pInternet.lossPct : 0) <= 10 && (pAlt ? pAlt.lossPct : 0) <= 10;
    if (avgBoth.length === 2 && avgBoth[0] > 200 && avgBoth[1] > 200 && lowLoss) {
      findings.push(F({
        id: 'high-latency',
        title: 'High Latency Path',
        rootCause: 'RTT is 200ms+ on both paths - high-latency link (satellite/geographical distance or carrier congestion)',
        layerNum: 3, severity: 'Medium', confidence: 75,
        evidence: '8.8.8.8 avg = ' + avgBoth[0] + ' ms, 1.1.1.1 avg = ' + avgBoth[1] + ' ms',
        fix: 'Choose a better latency path for real-time apps, or ask the ISP about the route',
        evidenceRefs: [
          { source: 'connectivity.pings.internet.avg', key: 'avg', value: avgBoth[0] },
          { source: 'connectivity.pings.alt.avg', key: 'avg', value: avgBoth[1] }
        ],
        disproveIf: 'Either internet path averages below 200 ms.'
      }));
    }

    // ---- DNS ----------------------------------------------------------------
    const dnsFailed = dns.status === 'failed' || !dns.address;
    const pingOk = !!(pInternet && pInternet.received > 0);
    if (pingOk && dnsFailed) {
      const tests = Array.isArray(dns.tests) ? dns.tests : [];
      if (tests.length) {
        const defTest = tests.find(t => t && dns.server && String(t.server) === String(dns.server)) || tests[0];
        const altOk = tests.some(t => t && t !== defTest && t.ok);
        if (altOk) {
          findings.push(F({
            id: 'dns-default-failing',
            title: 'Default DNS Server Failing',
            rootCause: 'The configured/default DNS server cannot resolve names, but a public resolver (8.8.8.8 / 1.1.1.1) can - the default DNS server is at fault',
            layerNum: 7, severity: 'High', confidence: 88,
            evidence: 'nslookup google.com via ' + (dns.server || 'default') + ' = failed; via a public resolver = OK',
            fix: 'Change the DNS server to 8.8.8.8 / 1.1.1.1 on the router or adapter, then flush the DNS cache',
            evidenceRefs: [{ source: 'dns.tests', key: 'tests', value: tests }],
            disproveIf: 'A lookup through the current default DNS server succeeds.'
          }));
        } else {
          findings.push(F({
            id: 'dns-all-failing',
            title: 'All DNS Failing',
            rootCause: 'Name resolution fails on the default AND on public resolvers, although IP connectivity works - DNS traffic is blocked or the servers are unreachable',
            layerNum: 7, severity: 'Critical', confidence: 90,
            evidence: 'nslookup google.com failed for every tested DNS server',
            fix: 'Check whether UDP/TCP port 53 is blocked, set DNS to 8.8.8.8 / 1.1.1.1, and flush the DNS cache',
            evidenceRefs: [{ source: 'dns.tests', key: 'tests', value: tests }],
            disproveIf: 'Any tested DNS server resolves a name.'
          }));
        }
      } else {
        findings.push(F({
          id: 'dns-resolution-failure',
          title: 'DNS Resolution Failure',
          rootCause: 'Ping (IP) works but DNS is not resolving - DNS server misconfiguration or the DNS server is down',
          layerNum: 7, severity: 'Critical', confidence: 93,
          evidence: 'ping 8.8.8.8 = OK, nslookup google.com = failed',
          fix: 'Set DNS to 8.8.8.8 / 1.1.1.1, check router DNS passthrough, or flush the DNS cache (ipconfig /flushdns)',
          evidenceRefs: [
            { source: 'connectivity.pings.internet.received', key: 'received', value: pInternet.received },
            { source: 'dns.status', key: 'status', value: dns.status || 'failed' }
          ],
          disproveIf: 'nslookup returns an address for a known host.'
        }));
      }
    } else if (pingOk && !dnsFailed && dns.lookupMs > 500) {
      findings.push(F({
        id: 'slow-dns',
        title: 'Slow DNS Resolution',
        rootCause: 'DNS lookup takes 500ms+ - slow/overloaded DNS server or a long query path',
        layerNum: 7, severity: 'Low', confidence: 70,
        evidence: 'nslookup google.com = ' + dns.lookupMs + ' ms via ' + dns.server,
        fix: 'Use a faster DNS (1.1.1.1/8.8.8.8) and clear the router DNS cache',
        evidenceRefs: [{ source: 'dns.lookupMs', key: 'lookupMs', value: dns.lookupMs }],
        disproveIf: 'DNS lookups complete in under 500 ms.'
      }));
    }

    // ---- Traceroute ---------------------------------------------------------
    const badHops = hops.filter(h => h.lossPct === 100);
    if (badHops.length > 0) {
      const firstBad = badHops[0];
      const hasLaterGood = hops.some(h => h.hop > firstBad.hop && h.lossPct === 0 && h.ip && h.ip !== 'Request timed out');
      if (!hasLaterGood) {
        findings.push(F({
          id: 'router-link-down',
          title: 'Router / Link Down at Hop ' + firstBad.hop,
          rootCause: '100% loss at hop ' + firstBad.hop + ' in the traceroute - fault on that router/link (fault location identified)',
          layerNum: 3, severity: 'High', confidence: 87,
          evidence: 'tracert: hop ' + firstBad.hop + ' = 100% loss (' + firstBad.ip + ')',
          fix: 'Check the router/operator at that hop - link down, BGP/routing issue',
          evidenceRefs: [{ source: 'trace.hops', key: 'hop' + firstBad.hop, value: firstBad.lossPct + '% loss' }],
          disproveIf: 'A later hop answers or the same hop answers in a repeat trace.'
        }));
      } else {
        findings.push(F({
          id: 'icmp-filtered',
          title: 'ICMP Filtering at Hop ' + firstBad.hop,
          rootCause: 'Hop ' + firstBad.hop + ' blocks ICMP but the path is alive - this is a firewall/security policy, not a fault',
          layerNum: 3, severity: 'Low', confidence: 60,
          evidence: 'tracert: hop ' + firstBad.hop + ' loss, but later hops are responsive',
          fix: 'No action needed - the path is healthy, the device is blocking ICMP',
          evidenceRefs: [{ source: 'trace.hops', key: 'hop' + firstBad.hop, value: '100% loss, later hops alive' }],
          disproveIf: 'The hop replies to ICMP in a repeat trace.'
        }));
      }
    }

    // ---- MTU (only when the evidence supports a fault) ----------------------
    const mtu = data.mtu || {};
    if (typeof mtu.mtu === 'number' && mtu.mtu > 0 && mtu.mtu < 1400) {
      findings.push(F({
        id: 'mtu-reduced',
        title: 'Reduced Path MTU',
        rootCause: 'The largest unfragmented ping payload the gateway accepts is small, giving a path MTU below 1400 bytes - tunnelling/PPPoE or a misconfigured link',
        layerNum: 3, severity: 'Low', confidence: 65,
        evidence: 'MTU probe = ' + mtu.mtu + ' bytes (payload ' + mtu.payload + ')',
        fix: 'Lower the adapter MTU to match the path (often 1492 for PPPoE) or fix the tunnel configuration',
        evidenceRefs: [{ source: 'mtu.mtu', key: 'mtu', value: mtu.mtu }],
        disproveIf: 'A 1400-byte unfragmented ping succeeds.'
      }));
    } else if (typeof mtu.mtu === 'number') {
      unusedEvidence.push({ key: 'mtu', reason: 'MTU probe normal (' + mtu.mtu + ' bytes) - not used for any finding.' });
    } else {
      unusedEvidence.push({ key: 'mtu', reason: 'No MTU probe result in this scan (no gateway or probe unsupported).' });
    }

    // ---- IPv6 (only when the evidence supports a fault) --------------------
    const ipv6 = data.ipv6 || {};
    if (ipv6.enabled === true && ipv6.loopbackOk === true && ipv6.internetOk === false) {
      unusedEvidence.push({ key: 'ipv6', reason: 'IPv6 loopback works but IPv6 internet is unreachable; without an IPv6 default-route probe this is not enough evidence for a fault.' });
    } else if (typeof ipv6.enabled !== 'boolean') {
      unusedEvidence.push({ key: 'ipv6', reason: 'No IPv6 probe result in this scan.' });
    } else {
      unusedEvidence.push({ key: 'ipv6', reason: 'IPv6 not contributing to a finding.' });
    }

    // ---- Informational: wired NIC down while on Wi-Fi ----------------------
    const eth = interfaces.find(i => /ethernet|lan|wired/i.test(i.name) && i.state && /disconnect/i.test(i.state));
    if (eth && wifiConnected) {
      findings.push(F({
        id: 'lan-cable-not-connected',
        title: 'LAN Cable Not Connected',
        rootCause: 'The Ethernet cable is not connected (wired interface down) - using the WiFi fallback',
        layerNum: 1, severity: 'Low', confidence: 80,
        evidence: 'netsh interface: Ethernet = Disconnected',
        fix: 'Connect the LAN cable if a wired connection is needed, otherwise ignore - the WiFi is healthy',
        evidenceRefs: [{ source: 'interfaces', key: eth.name, value: eth.state }],
        disproveIf: 'The wired interface state becomes Connected.'
      }));
    }

    // ---- Channel overlap ----------------------------------------------------
    if (wd) {
      const sameChannelCrowd = (Array.isArray(data.neighbors) ? data.neighbors : [])
        .filter(n => n.channel && n.channel === String(wd.channel) && n.signalPct > 40);
      if (sameChannelCrowd.length >= 2) {
        findings.push(F({
          id: 'channel-overlap',
          title: 'Channel Overlap with Neighbors',
          rootCause: sameChannelCrowd.length + ' strong neighboring APs are on the same channel as this WiFi - co-channel interference risk',
          layerNum: 2, severity: 'Low', confidence: 65,
          evidence: 'Neighbors on channel ' + wd.channel + ': ' + sameChannelCrowd.map(n => n.ssid + ' (' + n.signalPct + '%)').join(', '),
          fix: 'Change the router channel (1, 6, 11 - non-overlapping)',
          evidenceRefs: [{ source: 'neighbors', key: 'channel', value: wd.channel }],
          disproveIf: 'Fewer than two strong neighbors share the current channel.'
        }));
      }
    }

    return finalize(findings, contradictions, unusedEvidence, dq);
  }

  function finalize(findings, contradictions, unusedEvidence, dq) {
    findings.sort((a, b) => (SEV_ORDER[b.severity] || 0) - (SEV_ORDER[a.severity] || 0) || (b.confidence - a.confidence));
    const faults = findings.filter(f => isActionable(f.severity));

    let status, osiLayer, headline, topFindingId;
    if (faults.length > 0) {
      status = faults[0].severity;
      osiLayer = faults[0].layer;
      headline = faults[0].title;
      topFindingId = faults[0].id;
    } else {
      status = 'Healthy';
      osiLayer = null;
      headline = 'No fault detected';
      topFindingId = 'no-fault';
      findings.unshift({
        id: 'no-fault',
        title: 'No Fault Detected',
        rootCause: 'All diagnostics are normal - the network is healthy',
        layerNum: 2, layer: LAYERS[2],
        severity: 'Healthy', confidence: 90,
        evidence: 'Signal OK, gateway OK, internet OK, DNS OK, RTT variation normal',
        fix: 'No action required',
        evidenceRefs: [],
        disproveIf: 'Any diagnostic rule matches in a repeat scan.'
      });
    }

    const HEALTH_W = { 'Critical': 35, 'High': 20, 'Medium': 10, 'Low': 5, 'Healthy': 0 };
    let health = 100;
    for (const f of findings) {
      const w = HEALTH_W[f.severity] || 0;
      if (w <= 0) continue;
      const already = 100 - health;
      health -= Math.min(w, Math.max(0, 45 - already));
    }
    health = Math.max(0, Math.round(health));

    return {
      findings,
      osiLayer,
      healthScore: health,
      status,
      headline,
      topFindingId,
      contradictions,
      unusedEvidence,
      insufficientData: false,
      dataQuality: dq || {},
      generatedAt: new Date().toISOString()
    };
  }

  return { analyze, pctToDbm, pctToDbmNumber, SEV_ORDER, LAYERS };
});
