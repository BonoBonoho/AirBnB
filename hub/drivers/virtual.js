/**
 * 가상 플러그 드라이버 — 실제 하드웨어 없이 허브↔클라우드 파이프라인을
 * 검증하기 위한 테스트 기기. Matter/Zigbee 드라이버가 붙기 전의 발판.
 */
const state = { plug1: 'off' }

export const virtualDriver = {
  name: 'virtual',

  async devices() {
    return [
      { localId: 'plug1', name: '가상 플러그 (허브 테스트)', caps: ['switch'], model: 'StayPrice Virtual' },
    ]
  },

  async statuses() {
    return {
      plug1: {
        switch: state.plug1,
        // 켜져 있으면 40~60W 사이를 오가는 가짜 소비전력
        power: state.plug1 === 'on' ? Math.round(40 + Math.random() * 20) : 0,
      },
    }
  },

  async has(localId) {
    return localId in state
  },

  async command(localId, command) {
    if (command === 'on' || command === 'off') state[localId] = command
  },
}
