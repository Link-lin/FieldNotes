import { PageMessage } from "@/components/layout/PageMessage/PageMessage";
import { ButtonLink } from "@/components/ui/Button/Button";

export default function NotFound() {
  return (
    <PageMessage title="Trip not found" action={<ButtonLink href="/">Back to all trips</ButtonLink>}>
      It doesn&apos;t exist, or it isn&apos;t shared with you.
    </PageMessage>
  );
}
