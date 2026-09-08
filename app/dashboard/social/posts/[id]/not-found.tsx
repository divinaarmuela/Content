import Link from 'next/link'
import { Button } from '@/components/ui/button'
import PageTitle from '../../../ui/PageTitle'

/**
 * A POST PAGE WITH NOTHING BEHIND IT — said in words, not as a blank.
 *
 * The owner, 9 Sep 2026: "what happened to this post page, why is it blank".
 * The post row was there; the card it belonged to had been deleted from
 * the board that evening, and `notFound()` drew the framework's empty page.
 * A page that explains itself beats one that does not.
 */
export default function PostNotFound() {
  return (
    <div className="flex flex-col gap-4 pb-10">
      <PageTitle
        title="This post is not here any more"
        summary="Its card was deleted, or you are not on the client it belongs to. A post lives on its card: delete the card and the post goes with it."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/social/posts">Back to Posts</Link>
          </Button>
        }
      />
    </div>
  )
}
