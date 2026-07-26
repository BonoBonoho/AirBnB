# 스테이프라이스 허브 (베타)

집/숙소 안의 미니 컴퓨터에서 실행되어 **제조사 클라우드 없이** 기기를 직접 제어하고,
스테이프라이스 클라우드와 동기화하는 에이전트입니다.

```
[스테이프라이스 웹/앱] ←→ [AWS 클라우드] ←(3초 동기화)→ [허브 에이전트] ←(로컬)→ [기기들]
```

- 명령: 웹에서 켜기/끄기 → 클라우드 큐 → 허브가 3초 안에 받아 로컬 실행
- 상태: 허브가 30초마다 기기 목록·상태(전력 포함) 보고
- 오프라인 감지: 3분간 보고가 없으면 웹에서 오프라인 표시

## 설치 (라즈베리파이 / 맥 / 윈도우 공통)

1. **Node.js 18 이상** 설치
   - 라즈베리파이(라즈비안): `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs`
   - 맥: `brew install node` 또는 nodejs.org 설치 파일
2. 이 저장소의 `hub/` 폴더를 통째로 복사
3. 스테이프라이스 → 스마트룸 → ⚙️ 연동 설정 → **스테이프라이스 허브** 카드에서
   "새 허브 등록 코드 발급" → 표시된 JSON을 복사해 `hub/config.json`으로 저장
4. 실행:
   ```sh
   cd hub
   node agent.js
   ```
5. 스마트룸에서 "기기 다시 불러오기" → **가상 플러그 (허브 테스트)** 가 나타나면 성공.
   배정 후 웹에서 켜고 꺼보세요 — 허브 터미널에 명령 로그가 찍힙니다.

## 항상 실행 (라즈베리파이, systemd)

```ini
# /etc/systemd/system/stayprice-hub.service
[Unit]
Description=StayPrice Hub Agent
After=network-online.target

[Service]
ExecStart=/usr/bin/node /home/pi/hub/agent.js
Restart=always
RestartSec=5
User=pi

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl enable --now stayprice-hub
journalctl -u stayprice-hub -f   # 로그 보기
```

## 드라이버 구조

`drivers/` 폴더의 드라이버가 로컬 기기를 담당합니다. 각 드라이버는
`devices() / statuses() / has(id) / command(id, cmd, arg)` 4개 함수만 구현하면 됩니다.

| 드라이버 | 상태 | 설명 |
| --- | --- | --- |
| `virtual` | ✅ 동작 | 가상 플러그 — 파이프라인 검증용 |
| `matter` | 🔜 다음 단계 | Matter 플러그/전구 직접 제어 (matter.js) — Matter 기기 입고 후 |
| `tuya-local` | 후보 | Tuya 기기 LAN 직접 제어 (클라우드 우회) |

## 보안

- 허브 키는 발급 시 한 번만 표시되며 `config.json`에만 저장하세요.
- 허브를 분실하면 스마트룸 허브 카드에서 **삭제** — 즉시 키가 무효화됩니다.
