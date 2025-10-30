import TimeSlotGrid from "../components/booking/TimeSlotGrid";

const Home = () => {
  return (
    <main
      role="main"
      style={{
        minHeight: "100vh",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0f172a",
        padding: "0 16px",
      }}
    >
      <section
        aria-labelledby="booking-heading"
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#ffffff",
          borderRadius: 12,
          boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
          padding: 16,
          paddingTop: "max(16px, env(safe-area-inset-top))",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
        }}
      >
        <h1
          style={{
            margin: 0,
            marginBottom: 8,
            fontSize: 22,
            textAlign: "center",
            color: "#0f172a",
            fontWeight: 700,
          }}
        >
          会议室在线预约系统
        </h1>
        <text
          id="booking-heading"
          style={{
            margin: 0,
            marginBottom: 8,
            fontSize: 16,
            textAlign: "center",
            color: "#111827",
            fontWeight: 500,
          }}
        >
          时间段预定（并发与乐观更新演示）
        </text>
        <TimeSlotGrid />
      </section>
    </main>
  );
};

export default Home;
