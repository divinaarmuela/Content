'use client'

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { buttonVariants } from '@/components/ui/button'

/**
 * "Are you sure?" for the actions that cannot be undone.
 *
 * The app already asked properly in five places — Automations, Intake, Leads,
 * Team, and a type-to-confirm on deleting an item. A new hire learns from those
 * that delete always asks first, and then seven other places fired on one tap:
 * a customer's public comment, a paid booking, a bookable service, a resource,
 * a contact, a note, and a shared client password. Several were unlabelled
 * 14px trash icons.
 *
 * The copy contract, taken from the Automations dialog that got it right:
 * say WHAT STOPS WORKING, say whether it can be undone, and say what to do
 * instead when there is a safer option.
 */
export default function ConfirmAction({
  title, body, confirmLabel, onConfirm, children, destructive = true,
}: {
  /** a question naming the specific thing — never "Are you sure?" */
  title: string
  /** what stops working, whether it is reversible, what to do instead */
  body: string
  /** the verb, repeated — "Delete comment", not "OK" */
  confirmLabel: string
  onConfirm: () => void
  /** the control that used to fire immediately */
  children: React.ReactNode
  destructive?: boolean
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={destructive ? buttonVariants({ variant: 'destructive' }) : undefined}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
