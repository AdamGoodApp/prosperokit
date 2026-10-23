import type { PadButton } from '@prosperokit/react'
import { Image, Text, View } from '@prosperokit/react'
import circle from '../../assets/buttons/circle.png'
import cross from '../../assets/buttons/cross.png'
import dpadDown from '../../assets/buttons/dpad_down.png'
import dpadLeft from '../../assets/buttons/dpad_left.png'
import dpadRight from '../../assets/buttons/dpad_right.png'
import dpadUp from '../../assets/buttons/dpad_up.png'
import lStick from '../../assets/buttons/l_stick.png'
import l1 from '../../assets/buttons/l1.png'
import l2 from '../../assets/buttons/l2.png'
import options from '../../assets/buttons/options.png'
import r1 from '../../assets/buttons/r1.png'
import r2 from '../../assets/buttons/r2.png'
import square from '../../assets/buttons/square.png'
import touchpad from '../../assets/buttons/touchpad.png'
import triangle from '../../assets/buttons/triangle.png'
import { cn } from './cn'

/** Button glyph images (Arks' PS4 Buttons, CC BY 4.0 — see `assets/buttons/CREDITS.txt`). `r3` has no glyph. */
export const buttonGlyphs: Partial<Record<PadButton, string>> = {
  cross,
  circle,
  square,
  triangle,
  l1,
  r1,
  l2,
  r2,
  l3: lStick,
  options,
  touchpad,
  up: dpadUp,
  down: dpadDown,
  left: dpadLeft,
  right: dpadRight,
}

export interface ButtonGlyphProps {
  button: PadButton
  /** Pixels, default 32. */
  size?: number
  className?: string
  testID?: string
}

/** The glyph image for a pad button (a text chip when the pack has no image for it). */
export function ButtonGlyph({ button, size = 32, className, testID }: ButtonGlyphProps) {
  const source = buttonGlyphs[button]
  if (!source) {
    return (
      <View
        testID={testID}
        className={cn('items-center justify-center rounded-full bg-ps-surface-strong', className)}
        style={{ width: size, height: size }}
      >
        <Text className="text-xs font-semibold text-ps-text">{button.toUpperCase()}</Text>
      </View>
    )
  }
  return (
    <Image
      testID={testID}
      source={source}
      className={className}
      style={{ width: size, height: size }}
      resizeMode="contain"
    />
  )
}
