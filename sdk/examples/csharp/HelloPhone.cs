// A counter on your phone, in C#.
// .NET:        dotnet new console -n HelloPhone, copy this file and ../../csharp/RemotePhone.cs in, dotnet run
// .NET Framework / Mono: csc HelloPhone.cs ../../csharp/RemotePhone.cs
using System;
using RemotePC.Sdk;

static class HelloPhone
{
    static void Main()
    {
        int count = 0;
        string name = "";
        var app = new PhoneApp("hello-phone", "Hello", a => Ui.Screen("Hello",
            Ui.SectionWith("Counter", null,
                Ui.Text(count.ToString(), style: "display"),
                Ui.Stepper("Count", count, v => count = (int)v),
                Ui.Button("Reset", () => count = 0, role: "destructive")),
            Ui.SectionWith("Greeting", string.IsNullOrEmpty(name) ? null : "Hello, " + name + "!",
                Ui.Field("Name", name, v => name = v, placeholder: "Your name"))),
            icon: Ui.Icon("hand.wave.fill", "yellow"));
        Console.WriteLine("Hello is on your phone. Ctrl+C to stop.");
        app.Run();
    }
}
