/** Lane-local warehouse layout, ported from the original game (1 unit ≈ 1 metre). */
export const PLAYER_COLORS = ['#2f7cf6', '#ff3d7f', '#1fb257', '#ff8a1f'] as const
export const PLAYER_NAMES = ['ฟ้า', 'ชมพู', 'เขียว', 'ส้ม'] as const
export const ZONE_COLORS = ['#1f6fe0', '#ff6a13', '#14a54a', '#8a3bd1', '#e3262b'] as const
export const STAGE_NAMES = ['ลงสินค้า', 'พักสินค้าขาเข้า', 'จัดเก็บสินค้า', 'เตรียมสินค้าขาออก', 'โหลดสินค้า'] as const

export const laneX = (i: number): number => -15 + i * 10
export const SLOT_X = [-3.6, -1.8, 0, 1.8, 3.6]
export const Z2 = [-6.8, -5.2]
export const Z4 = [7.4, 9.0]
export const RK = { x0: -3.1, x1: 3.1, z0: -2.55, z1: -1.3 }
export const BAY = (RK.x1 - RK.x0) / 5
export const bayX = (b: number): number => RK.x0 + BAY * (b + 0.5)
export const RACK_Z = (RK.z0 + RK.z1) / 2
/** Pallet base height for the lower and upper rack levels. */
export const LVY = [0.02, 1.31]
export const PSPOT = { x: 0, z: -9.6 }
export const TRUCK_Z = -11.5
export const BOX_PER = 4
export const PEN_BUMP = 3
export const LANE_HX = 4.8
export const FORK_REST = 0.12
export const FORK_CARRY = 0.3

export const slotPos = (zone: 2 | 4, i: number): { x: number; z: number } => ({
  x: SLOT_X[i % 5],
  z: (zone === 2 ? Z2 : Z4)[Math.floor(i / 5)],
})
export const cellName = (c: number): string => (c >= 5 ? 'ชั้นบน' : 'ชั้นล่าง') + ' ช่อง ' + ((c % 5) + 1)
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v))
export const dist = (ax: number, az: number, bx: number, bz: number): number => Math.hypot(ax - bx, az - bz)
