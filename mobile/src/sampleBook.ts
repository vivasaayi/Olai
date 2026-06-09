import type { Book } from "./types";

export const sampleBook: Book = {
  id: "bookforge-sample-robotics",
  title: "Learning With Robots",
  synopsis: "A short starter book that demonstrates the BookForge reader experience.",
  audience: "Beginner",
  tone: "Conversational",
  tags: ["STEM", "Robotics", "Beginner"],
  chapters: [
    {
      id: "chapter-what-is-a-robot",
      title: "What Is a Robot?",
      synopsis: "Robots combine sensing, decision making, and action.",
      goals: "Understand the basic loop behind most robots.",
      sections: [
        {
          id: "section-robot-loop",
          title: "The Robot Loop",
          intent: "Explain sense-think-act in simple language.",
          summary: "A robot observes the world, decides what to do, and acts.",
          content:
            "A robot is a machine that can sense something, make a decision, and then act. This pattern is often called the sense-think-act loop.\n\nA floor-cleaning robot senses walls and furniture. It thinks about where it can move next. Then it acts by turning its wheels and continuing the cleaning path.\n\nThe same idea appears in larger robots too. A warehouse robot scans shelves, plans a route, and carries items to the right station.",
          keywords: ["sensor", "decision", "actuator"],
          persona: "beginner",
          durationMinutes: 4,
          resources: [],
        },
        {
          id: "section-human-instructions",
          title: "Why Instructions Matter",
          intent: "Show that robots need clear goals and constraints.",
          summary: "Robots follow goals, rules, and limits created by people.",
          content:
            "Robots do not magically know what people want. They need instructions, examples, and limits.\n\nA delivery robot may have a goal like 'bring this package to room 204.' It also needs limits: avoid stairs, stop for people, and do not enter private areas.\n\nGood robot design is partly about good instruction design. The clearer the goal, the safer and more useful the robot can be.",
          keywords: ["goal", "constraint", "safety"],
          persona: "beginner",
          durationMinutes: 3,
          resources: [],
        },
      ],
    },
    {
      id: "chapter-sensors",
      title: "Sensors and Decisions",
      synopsis: "Sensors convert the real world into signals a computer can use.",
      goals: "Connect common sensors to everyday robot behavior.",
      sections: [
        {
          id: "section-sensors",
          title: "Sensors Are Clues",
          intent: "Introduce sensors as imperfect clues.",
          summary: "A sensor gives a robot clues, not perfect truth.",
          content:
            "A sensor is a device that measures something. Cameras measure light, microphones measure sound, and distance sensors estimate how far away an object is.\n\nSensors are powerful, but they are not perfect. A camera may struggle in the dark. A microphone may hear background noise. A good robot checks multiple clues before making an important decision.",
          keywords: ["camera", "microphone", "distance sensor"],
          persona: "beginner",
          durationMinutes: 5,
          resources: [],
        },
      ],
    },
  ],
};
