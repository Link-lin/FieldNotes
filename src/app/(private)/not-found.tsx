import Link from "next/link";

export default function NotFound() {
  return (
    <main className="trip-wrap">
      <div className="trip">
        <h1>Trip not found</h1>
        <p className="note">It doesn&apos;t exist, or it isn&apos;t shared with you.</p>
        <Link className="pill" href="/">Back to all trips</Link>
      </div>
    </main>
  );
}
