import type { FormQuestion } from '../types'

/**
 * 기본 게스트 설문 템플릿 — 사용자의 기존 Notion 양식(산티아고 숙소 설문지)을 그대로 옮김.
 * 성함·숙박일정은 예약 정보에서 자동으로 채워지므로 질문에서 제외.
 */
export const DEFAULT_FORM_QUESTIONS: FormQuestion[] = [
  {
    id: 'guests',
    label: '머무시는 인원은 몇 분일까요?',
    description: '숫자만 입력해주세요',
    type: 'number',
    required: true,
  },
  {
    id: 'composition',
    label: '게스트님들이 어떻게 구성되어 있나요?',
    description: '예: 가족 성인 2명 아이 2명, 연인 성인 2명, 친구 성인 8명 등',
    type: 'text',
    required: true,
  },
  {
    id: 'purpose',
    label: '여행 목적이 어떻게 되나요?',
    description: '단순 여행, 데이트, 가족 이벤트, 기념일, 회식, 친구들 모임 등 (이벤트 풍선 같은 것 준비해드려요)',
    type: 'text',
    required: true,
  },
  {
    id: 'reason',
    label: '저희 숙소를 선택하신 이유가 무엇인가요?',
    description: '복수 선택 가능',
    type: 'multiselect',
    options: ['가격', '예쁜 인테리어', '편의성', '위치', '루프탑 / 바베큐', '넉넉한 공간', '기타'],
    required: true,
  },
  {
    id: 'reasonEtc',
    label: '기타를 선택하셨다면 이유를 말씀해주세요',
    type: 'text',
  },
  {
    id: 'checkinTime',
    label: '체크인 예정시간을 알려주세요',
    description: '정규 체크인 시간은 16시입니다!',
    type: 'text',
    required: true,
  },
  {
    id: 'checkoutTime',
    label: '체크아웃 예정시간을 알려주세요',
    description: '정규 체크아웃 시간은 11시입니다!',
    type: 'text',
    required: true,
  },
  {
    id: 'phone',
    label: '게스트님의 대표 핸드폰 번호가 어떻게 될까요?',
    description: '원활한 소통과, 남겨주신 번호의 마지막 4자리가 집의 비밀번호로 쓰입니다.',
    type: 'text',
    required: true,
  },
  {
    id: 'region',
    label: '어느 지역에서 오시나요?',
    description: '비수기나 특가 이벤트 때 따로 메시지 드려요 😃',
    type: 'text',
    required: true,
  },
  {
    id: 'transport',
    label: '무엇을 타고 오시나요?',
    description: '짐픽업서비스 있어요!',
    type: 'multiselect',
    options: ['자차', '대중교통', '비행기', '기차'],
    required: true,
  },
  {
    id: 'bbq',
    label: '루프탑 불멍 및 바베큐를 즐기실 예정인가요?',
    description: '숯, 장작, 그릴 등 준비 비용 있어요!',
    type: 'select',
    options: ['네', '아니오', '추후 결정'],
    required: true,
  },
  {
    id: 'paidServices',
    label: '원하시는 유료 서비스가 있을까요?',
    description: '없으면 선택 안 하셔도 됩니다!',
    type: 'multiselect',
    options: ['짐픽업서비스', '조식제공'],
  },
  {
    id: 'requests',
    label: '또 다른 요청 사항이 있을까요? 가능하면 최대한 준비해드리겠습니다.',
    description: '레이트 체크아웃, 픽업 서비스, 유아용 침대, 반려견 배변시트 등',
    type: 'longtext',
  },
  {
    id: 'reviewEvent',
    label: '후기 이벤트 참여 여부',
    description:
      '후기 확인 및 정산 시 5,000원~15,000원 페이백 및 재방문 시 5% 추가 할인 이벤트 문자를 드립니다. 참여를 원하시면 계좌번호와 예금주를 적어주세요.',
    type: 'text',
    required: true,
  },
  {
    id: 'noSmoking',
    label: '숙소 전체가 금연 건물입니다. 동의하시나요?',
    description:
      '쾌적한 환경을 위해 전 객실 흡연을 엄격히 금지하고 있습니다. 다른 게스트에게도 전파해 주시고, 대문 밖에서 흡연해 주세요. 흡연 시 객실당 10만원의 벌금이 부과됩니다.',
    type: 'select',
    options: ['예'],
    required: true,
  },
]
